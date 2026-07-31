from decimal import Decimal
from typing import Any

from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError
from fastapi import HTTPException, status

from .aws import Aws
from .config import Settings
from .models import Book, Page, utc_now


def _not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Resource not found")


def _to_dynamo(value: Any) -> Any:
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {key: _to_dynamo(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_to_dynamo(item) for item in value]
    return value


class Repositories:
    def __init__(self, aws: Aws, settings: Settings):
        self.books = aws.dynamodb.Table(settings.books_table)
        self.pages = aws.dynamodb.Table(settings.pages_table)
        self.cache = aws.dynamodb.Table(settings.cache_table)
        self.books_owner_index = settings.books_owner_index

    def create_book(self, item: dict[str, Any]) -> Book:
        try:
            self.books.put_item(
                Item=_to_dynamo(item),
                ConditionExpression="attribute_not_exists(book_id)",
            )
        except ClientError as exc:
            if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
                raise HTTPException(status.HTTP_409_CONFLICT, "Book already exists") from exc
            raise
        return Book.model_validate(item)

    def get_book(self, book_id: str, owner_id: str) -> Book:
        item = self.books.get_item(
            Key={"book_id": book_id}, ConsistentRead=True
        ).get("Item")
        if not item or item.get("owner_id") != owner_id:
            raise _not_found()
        return Book.model_validate(item)

    def list_books(self, owner_id: str, limit: int = 50) -> list[Book]:
        result = self.books.query(
            IndexName=self.books_owner_index,
            KeyConditionExpression=Key("owner_id").eq(owner_id),
            ScanIndexForward=False,
            Limit=limit,
        )
        return [Book.model_validate(item) for item in result.get("Items", [])]

    def update_book(
        self,
        book_id: str,
        owner_id: str,
        expression: str,
        values: dict[str, Any],
        names: dict[str, str] | None = None,
    ) -> Book:
        kwargs: dict[str, Any] = {
            "Key": {"book_id": book_id},
            "UpdateExpression": expression,
            "ConditionExpression": "owner_id = :owner",
            "ExpressionAttributeValues": _to_dynamo({":owner": owner_id, **values}),
            "ReturnValues": "ALL_NEW",
        }
        if names:
            kwargs["ExpressionAttributeNames"] = names
        try:
            result = self.books.update_item(**kwargs)
        except ClientError as exc:
            if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
                raise _not_found() from exc
            raise
        return Book.model_validate(result["Attributes"])

    def delete_book(self, book_id: str, owner_id: str) -> None:
        try:
            self.books.delete_item(
                Key={"book_id": book_id},
                ConditionExpression="owner_id = :owner",
                ExpressionAttributeValues={":owner": owner_id},
            )
        except ClientError as exc:
            if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
                raise _not_found() from exc
            raise

    def put_page(self, item: dict[str, Any], *, only_if_absent: bool = False) -> Page:
        args: dict[str, Any] = {"Item": _to_dynamo(item)}
        if only_if_absent:
            args["ConditionExpression"] = (
                "attribute_not_exists(book_id) AND attribute_not_exists(page_number)"
            )
        try:
            self.pages.put_item(**args)
        except ClientError as exc:
            if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
                return self.get_page(item["book_id"], int(item["page_number"]), item["owner_id"])
            raise
        return Page.model_validate(item)

    def get_page(self, book_id: str, page_number: int, owner_id: str) -> Page:
        item = self.pages.get_item(
            Key={"book_id": book_id, "page_number": page_number},
            ConsistentRead=True,
        ).get("Item")
        if not item or item.get("owner_id") != owner_id:
            raise _not_found()
        return Page.model_validate(item)

    def list_pages(self, book_id: str) -> list[dict[str, Any]]:
        return self.pages.query(
            KeyConditionExpression=Key("book_id").eq(book_id)
        ).get("Items", [])

    def update_page(
        self,
        book_id: str,
        page_number: int,
        owner_id: str,
        expression: str,
        values: dict[str, Any],
        names: dict[str, str] | None = None,
        extra_condition: str | None = None,
    ) -> Page:
        condition = "owner_id = :owner"
        if extra_condition:
            condition += f" AND ({extra_condition})"
        kwargs: dict[str, Any] = {
            "Key": {"book_id": book_id, "page_number": page_number},
            "UpdateExpression": expression,
            "ConditionExpression": condition,
            "ExpressionAttributeValues": _to_dynamo({":owner": owner_id, **values}),
            "ReturnValues": "ALL_NEW",
        }
        if names:
            kwargs["ExpressionAttributeNames"] = names
        try:
            result = self.pages.update_item(**kwargs)
        except ClientError as exc:
            if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
                raise _not_found() from exc
            raise
        return Page.model_validate(result["Attributes"])

    def delete_pages(self, book_id: str) -> None:
        items = self.list_pages(book_id)
        with self.pages.batch_writer() as batch:
            for item in items:
                batch.delete_item(
                    Key={"book_id": book_id, "page_number": item["page_number"]}
                )

    def get_cache(self, cache_key: str) -> dict[str, Any] | None:
        return self.cache.get_item(Key={"cache_key": cache_key}).get("Item")

    def put_cache(self, cache_key: str, item: dict[str, Any]) -> None:
        self.cache.put_item(
            Item=_to_dynamo({"cache_key": cache_key, **item, "updated_at": utc_now()})
        )
