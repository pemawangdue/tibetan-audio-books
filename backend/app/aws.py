import json
from functools import lru_cache
from typing import Any

import boto3

from .config import Settings, get_settings


class Aws:
    def __init__(self, settings: Settings):
        kwargs: dict[str, Any] = {"region_name": settings.aws_region}
        if settings.aws_endpoint_url:
            kwargs["endpoint_url"] = settings.aws_endpoint_url
        self.dynamodb = boto3.resource("dynamodb", **kwargs)
        self.s3 = boto3.client("s3", **kwargs)
        self.sqs = boto3.client("sqs", **kwargs)
        self.settings = settings

    def send(self, queue_url: str, message: dict, *, group_id: str | None = None) -> None:
        if not queue_url:
            raise RuntimeError("queue URL is not configured")
        request: dict[str, Any] = {
            "QueueUrl": queue_url,
            "MessageBody": json.dumps(message, separators=(",", ":")),
        }
        if queue_url.endswith(".fifo"):
            request["MessageGroupId"] = group_id or message.get("book_id", "dadhep")
            request["MessageDeduplicationId"] = (
                f"{message.get('kind')}:{message.get('book_id')}:"
                f"{message.get('page_number', '')}:{message.get('version', 1)}"
            )
        self.sqs.send_message(**request)


@lru_cache
def get_aws() -> Aws:
    return Aws(get_settings())
