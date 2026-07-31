from pathlib import Path
import shutil
import subprocess
import sys
from typing import Optional

import jsii
from aws_cdk import (
    BundlingOptions,
    CfnOutput,
    Duration,
    ILocalBundling,
    RemovalPolicy,
    Size,
    Stack,
    aws_apigatewayv2 as apigwv2,
    aws_apigatewayv2_authorizers as authorizers,
    aws_apigatewayv2_integrations as integrations,
    aws_cloudfront as cloudfront,
    aws_cloudfront_origins as origins,
    aws_cloudwatch as cloudwatch,
    aws_cognito as cognito,
    aws_dynamodb as dynamodb,
    aws_lambda as lambda_,
    aws_lambda_event_sources as event_sources,
    aws_logs as logs,
    aws_s3 as s3,
    aws_s3_deployment as s3deploy,
    aws_secretsmanager as secretsmanager,
    aws_sqs as sqs,
)
from constructs import Construct


PROTECTED_API_METHODS = [
    apigwv2.HttpMethod.GET,
    apigwv2.HttpMethod.POST,
    apigwv2.HttpMethod.PUT,
    apigwv2.HttpMethod.PATCH,
    apigwv2.HttpMethod.DELETE,
    apigwv2.HttpMethod.HEAD,
]


@jsii.implements(ILocalBundling)
class LocalPythonBundler:
    """Build Lambda-compatible Linux wheels without requiring local Docker."""

    def __init__(self, source: str) -> None:
        self.source = Path(source)

    def try_bundle(self, output_dir: str, _options: BundlingOptions) -> bool:
        output = Path(output_dir)
        subprocess.run(
            [
                sys.executable,
                "-m",
                "pip",
                "install",
                "-r",
                str(self.source / "requirements.txt"),
                "--target",
                str(output),
                "--platform",
                "manylinux2014_x86_64",
                "--python-version",
                "3.12",
                "--implementation",
                "cp",
                "--only-binary=:all:",
                "--upgrade",
            ],
            check=True,
        )
        shutil.copytree(self.source / "app", output / "app", dirs_exist_ok=True)
        return True


class DadhepStack(Stack):
    """Complete, serverless Dadhep MVP infrastructure."""

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        *,
        backend_path: Optional[str] = None,
        frontend_dist_path: Optional[str] = None,
        **kwargs,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        repository_root = Path(__file__).resolve().parents[2]
        backend_asset = backend_path or str(repository_root / "backend")
        frontend_asset = frontend_dist_path or str(repository_root / "frontend" / "dist")

        api_memory = int(self.node.try_get_context("apiMemoryMb") or 1024)
        api_timeout = int(self.node.try_get_context("apiTimeoutSeconds") or 30)
        api_ephemeral = int(self.node.try_get_context("apiEphemeralStorageMb") or 512)
        api_concurrency = int(self.node.try_get_context("apiReservedConcurrency") or 0)
        split_memory = int(self.node.try_get_context("splitMemoryMb") or 2048)
        split_timeout = int(self.node.try_get_context("splitTimeoutSeconds") or 300)
        split_ephemeral = int(self.node.try_get_context("splitEphemeralStorageMb") or 2048)
        split_concurrency = int(self.node.try_get_context("splitReservedConcurrency") or 0)
        document_batch = int(self.node.try_get_context("documentBatchSize") or 1)
        document_concurrency = int(
            self.node.try_get_context("documentMaxConcurrency") or split_concurrency
        )
        worker_memory = int(self.node.try_get_context("workerMemoryMb") or 3008)
        worker_timeout = int(self.node.try_get_context("workerTimeoutSeconds") or 300)
        worker_ephemeral = int(self.node.try_get_context("workerEphemeralStorageMb") or 4096)
        worker_concurrency = int(self.node.try_get_context("workerReservedConcurrency") or 0)
        priority_batch = int(self.node.try_get_context("priorityBatchSize") or 1)
        priority_concurrency = int(
            self.node.try_get_context("priorityMaxConcurrency") or 12
        )
        standard_batch = int(self.node.try_get_context("standardBatchSize") or 1)
        standard_concurrency = int(
            self.node.try_get_context("standardMaxConcurrency") or 8
        )
        if priority_concurrency + standard_concurrency > worker_concurrency:
            raise ValueError(
                "priorityMaxConcurrency + standardMaxConcurrency must not exceed "
                "workerReservedConcurrency"
            )

        uploads_bucket = self._private_bucket("uploads")
        uploads_bucket.add_cors_rule(
            allowed_methods=[s3.HttpMethods.POST],
            allowed_origins=["*"],
            allowed_headers=["*"],
            exposed_headers=["ETag"],
            max_age=900,
        )
        assets_bucket = self._private_bucket("assets")
        frontend_bucket = self._private_bucket("frontend")

        books_table = dynamodb.Table(
            self,
            "BooksTable",
            table_name=f"{self.stack_name.lower()}-books",
            partition_key=dynamodb.Attribute(
                name="book_id", type=dynamodb.AttributeType.STRING
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            point_in_time_recovery_specification=dynamodb.PointInTimeRecoverySpecification(
                point_in_time_recovery_enabled=True
            ),
            encryption=dynamodb.TableEncryption.AWS_MANAGED,
            removal_policy=RemovalPolicy.DESTROY,
        )
        books_table.add_global_secondary_index(
            index_name="owner-created_at-index",
            partition_key=dynamodb.Attribute(
                name="owner_id", type=dynamodb.AttributeType.STRING
            ),
            sort_key=dynamodb.Attribute(
                name="created_at", type=dynamodb.AttributeType.STRING
            ),
            projection_type=dynamodb.ProjectionType.ALL,
        )
        books_table.add_global_secondary_index(
            index_name="status-updated_at-index",
            partition_key=dynamodb.Attribute(
                name="status", type=dynamodb.AttributeType.STRING
            ),
            sort_key=dynamodb.Attribute(
                name="updated_at", type=dynamodb.AttributeType.STRING
            ),
            projection_type=dynamodb.ProjectionType.ALL,
        )

        pages_table = dynamodb.Table(
            self,
            "PagesTable",
            table_name=f"{self.stack_name.lower()}-pages",
            partition_key=dynamodb.Attribute(
                name="book_id", type=dynamodb.AttributeType.STRING
            ),
            sort_key=dynamodb.Attribute(
                name="page_number", type=dynamodb.AttributeType.NUMBER
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            point_in_time_recovery_specification=dynamodb.PointInTimeRecoverySpecification(
                point_in_time_recovery_enabled=True
            ),
            encryption=dynamodb.TableEncryption.AWS_MANAGED,
            removal_policy=RemovalPolicy.DESTROY,
        )
        cache_table = dynamodb.Table(
            self,
            "CacheTable",
            table_name=f"{self.stack_name.lower()}-cache",
            partition_key=dynamodb.Attribute(
                name="cache_key", type=dynamodb.AttributeType.STRING
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            time_to_live_attribute="expires_at",
            encryption=dynamodb.TableEncryption.AWS_MANAGED,
            removal_policy=RemovalPolicy.DESTROY,
        )

        document_queue, document_dlq = self._queue_pair(
            "Document", split_timeout
        )
        priority_queue, priority_dlq = self._queue_pair(
            "PagePriority", worker_timeout
        )
        standard_queue, standard_dlq = self._queue_pair(
            "PageStandard", worker_timeout
        )

        monlam_secret = secretsmanager.Secret.from_secret_name_v2(
            self,
            "MonlamSecret",
            str(self.node.try_get_context("monlamSecretName") or "dadhep/monlam-api-key"),
        )

        common_environment = {
            "ENV": "production",            
            "BOOKS_TABLE": books_table.table_name,
            "BOOKS_OWNER_INDEX": "owner-created_at-index",
            "PAGES_TABLE": pages_table.table_name,
            "CACHE_TABLE": cache_table.table_name,
            "UPLOAD_BUCKET": uploads_bucket.bucket_name,
            "ASSETS_BUCKET": assets_bucket.bucket_name,
        }
        backend_code = lambda_.Code.from_asset(
            backend_asset,
            bundling=BundlingOptions(
                image=lambda_.Runtime.PYTHON_3_12.bundling_image,
                local=LocalPythonBundler(backend_asset),
                command=[
                    "bash",
                    "-c",
                    "pip install -r requirements.txt -t /asset-output "
                    "&& cp -au app /asset-output/",
                ],
            ),
        )

        api_function = self._function(
            "api",
            backend_code,
            str(self.node.try_get_context("apiHandler") or "app.handler.handler"),
            api_memory,
            api_timeout,
            api_ephemeral,
            api_concurrency,
            {
                **common_environment,
                "SERVICE": "api",
                "SPLIT_QUEUE_URL": document_queue.queue_url,
            },
        )
        split_function = self._function(
            "page-splitter",
            backend_code,
            str(self.node.try_get_context("splitHandler") or "app.split_worker.handler"),
            split_memory,
            split_timeout,
            split_ephemeral,
            split_concurrency,
            {
                **common_environment,
                "SERVICE": "split",
                "PRIORITY_QUEUE_URL": priority_queue.queue_url,
                "PAGE_QUEUE_URL": standard_queue.queue_url,
            },
        )
        worker_function = self._function(
            "page-worker",
            backend_code,
            str(self.node.try_get_context("pageWorkerHandler") or "app.page_worker.handler"),
            worker_memory,
            worker_timeout,
            worker_ephemeral,
            worker_concurrency,
            {
                **common_environment,
                "SERVICE": "page",
                "MONLAM_PROVIDER": str(
                    self.node.try_get_context("monlamProvider") or "mock"
                ),
                "MONLAM_API_URL": str(
                    self.node.try_get_context("monlamApiUrl") or ""
                ),
                "MONLAM_API_KEY": monlam_secret.secret_value.unsafe_unwrap(),
                "PROCESSING_LEASE_SECONDS": str(worker_timeout + 30),
            },
        )

        split_function.add_event_source(
            event_sources.SqsEventSource(
                document_queue,
                batch_size=document_batch,
                max_concurrency=document_concurrency,
                report_batch_item_failures=True,
            )
        )
        worker_function.add_event_source(
            event_sources.SqsEventSource(
                priority_queue,
                batch_size=priority_batch,
                max_concurrency=priority_concurrency,
                report_batch_item_failures=True,
            )
        )
        worker_function.add_event_source(
            event_sources.SqsEventSource(
                standard_queue,
                batch_size=standard_batch,
                max_concurrency=standard_concurrency,
                report_batch_item_failures=True,
            )
        )

        books_table.grant_read_write_data(api_function)
        pages_table.grant_read_write_data(api_function)
        uploads_bucket.grant_read_write(api_function)
        assets_bucket.grant_read_write(api_function)
        document_queue.grant_send_messages(api_function)

        uploads_bucket.grant_read(split_function)
        books_table.grant_read_write_data(split_function)
        pages_table.grant_read_write_data(split_function)
        assets_bucket.grant_read_write(split_function)
        priority_queue.grant_send_messages(split_function)
        standard_queue.grant_send_messages(split_function)

        books_table.grant_read_write_data(worker_function)
        pages_table.grant_read_write_data(worker_function)
        cache_table.grant_read_write_data(worker_function)
        assets_bucket.grant_read_write(worker_function)
        monlam_secret.grant_read(worker_function)

        user_pool = cognito.UserPool(
            self,
            "UserPool",
            self_sign_up_enabled=True,
            sign_in_aliases=cognito.SignInAliases(email=True, phone=True),
            auto_verify=cognito.AutoVerifiedAttrs(email=True, phone=True),
            account_recovery=cognito.AccountRecovery.EMAIL_ONLY,
            standard_attributes=cognito.StandardAttributes(
                email=cognito.StandardAttribute(required=False, mutable=True),
                phone_number=cognito.StandardAttribute(required=False, mutable=True),
            ),
            password_policy=cognito.PasswordPolicy(
                min_length=10,
                require_digits=True,
                require_lowercase=True,
                require_symbols=True,
                require_uppercase=True,
            ),
            removal_policy=RemovalPolicy.RETAIN,
        )
        user_pool_client = user_pool.add_client(
            "WebClient",
            auth_flows=cognito.AuthFlow(
                user_password=True,
                user_srp=True,
            ),
            generate_secret=False,
            prevent_user_existence_errors=True,
        )
        api_function.add_environment(
            "COGNITO_USER_POOL_ID", user_pool.user_pool_id
        )
        api_function.add_environment(
            "COGNITO_APP_CLIENT_ID", user_pool_client.user_pool_client_id
        )

        api_integration = integrations.HttpLambdaIntegration(
            "ApiIntegration", api_function
        )
        jwt_authorizer = authorizers.HttpJwtAuthorizer(
            "CognitoAuthorizer",
            f"https://cognito-idp.{self.region}.amazonaws.com/{user_pool.user_pool_id}",
            jwt_audience=[user_pool_client.user_pool_client_id],
        )
        http_api = apigwv2.HttpApi(
            self,
            "HttpApi",
            cors_preflight=apigwv2.CorsPreflightOptions(
                allow_origins=["*"],
                allow_headers=[
                    "authorization",
                    "content-type",
                    "accept",
                    "origin",
                ],
                allow_methods=[apigwv2.CorsHttpMethod.ANY],
                max_age=Duration.days(1),
            ),
            create_default_stage=True,
        )
        # Public docs and health endpoints (no auth required)
        for public_path in (
            "/health",
            "/openapi.json",
            "/docs",
            "/docs/{proxy+}",
            "/redoc",
            "/redoc/{proxy+}",
        ):
            http_api.add_routes(
                path=public_path,
                methods=[apigwv2.HttpMethod.ANY],
                integration=api_integration,
            )

        # Application routes require Cognito JWT authorizer.
        # OPTIONS is excluded so CORS preflight is handled by API Gateway.
        for route_path in ("/", "/{proxy+}"):
            http_api.add_routes(
                path=route_path,
                methods=PROTECTED_API_METHODS,
                integration=api_integration,
                authorizer=jwt_authorizer,
            )

        spa_rewrite = cloudfront.Function(
            self,
            "SpaRewriteFunction",
            code=cloudfront.FunctionCode.from_inline(
                "function handler(event) {\n"
                "  var r = event.request;\n"
                "  if (!r.uri.includes('.') && !r.uri.startsWith('/assets/')) "
                "{ r.uri = '/index.html'; }\n"
                "  return r;\n"
                "}"
            ),
        )
        distribution = cloudfront.Distribution(
            self,
            "FrontendDistribution",
            default_root_object="index.html",
            default_behavior=cloudfront.BehaviorOptions(
                origin=origins.S3BucketOrigin.with_origin_access_control(
                    frontend_bucket
                ),
                viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                allowed_methods=cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
                cached_methods=cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
                cache_policy=cloudfront.CachePolicy.CACHING_OPTIMIZED,
                compress=True,
                function_associations=[
                    cloudfront.FunctionAssociation(
                        function=spa_rewrite,
                        event_type=cloudfront.FunctionEventType.VIEWER_REQUEST,
                    )
                ],
            ),
            minimum_protocol_version=cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
            price_class=cloudfront.PriceClass.PRICE_CLASS_100,
        )
        s3deploy.BucketDeployment(
            self,
            "DeployFrontend",
            sources=[
                s3deploy.Source.asset(frontend_asset),
                 s3deploy.Source.data(
                    "config.js",
                    f"""window.APP_CONFIG = {{
                        VITE_AUTH_MODE: "cognito",
                        VITE_COGNITO_USER_POOL_ID: "{user_pool.user_pool_id}",
                        VITE_COGNITO_CLIENT_ID: "{user_pool_client.user_pool_client_id}",
                        VITE_API_URL: "{http_api.api_endpoint}",
                        VITE_USE_MOCK_API: "false"
                    }};""",
                ),
                ],
            destination_bucket=frontend_bucket,
            distribution=distribution,
            distribution_paths=["/*"],
            prune=True,
        )

        self._add_alarms(
            http_api,
            (api_function, split_function, worker_function),
            (
                (document_queue, document_dlq),
                (priority_queue, priority_dlq),
                (standard_queue, standard_dlq),
            ),
        )

        outputs = {
            "ApiUrl": http_api.api_endpoint,
            "CloudFrontUrl": f"https://{distribution.distribution_domain_name}",
            "CloudFrontDistributionId": distribution.distribution_id,
            "UserPoolId": user_pool.user_pool_id,
            "UserPoolClientId": user_pool_client.user_pool_client_id,
            "UploadsBucketName": uploads_bucket.bucket_name,
            "AssetsBucketName": assets_bucket.bucket_name,
            "FrontendBucketName": frontend_bucket.bucket_name,
            "BooksTableName": books_table.table_name,
            "PagesTableName": pages_table.table_name,
            "CacheTableName": cache_table.table_name,
            "DocumentQueueUrl": document_queue.queue_url,
            "PriorityQueueUrl": priority_queue.queue_url,
            "StandardQueueUrl": standard_queue.queue_url,
        }
        for output_id, value in outputs.items():
            CfnOutput(self, output_id, value=value)

    def _private_bucket(self, construct_id: str) -> s3.Bucket:
        return s3.Bucket(
            self,
            construct_id,
            bucket_name=f"{self.stack_name.lower()}-{construct_id}-{self.region}",
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            encryption=s3.BucketEncryption.S3_MANAGED,
            enforce_ssl=True,
            versioned=True,
            removal_policy=RemovalPolicy.DESTROY,
        )

    def _queue_pair(
        self, prefix: str, consumer_timeout_seconds: int
    ) -> tuple[sqs.Queue, sqs.Queue]:
        dlq = sqs.Queue(
            self,
            f"{prefix}DeadLetterQueue",
            encryption=sqs.QueueEncryption.SQS_MANAGED,
            retention_period=Duration.days(14),
        )
        queue = sqs.Queue(
            self,
            f"{prefix}Queue",
            encryption=sqs.QueueEncryption.SQS_MANAGED,
            visibility_timeout=Duration.seconds(
                min(43200, max(60, consumer_timeout_seconds * 6))
            ),
            retention_period=Duration.days(4),
            dead_letter_queue=sqs.DeadLetterQueue(
                queue=dlq,
                max_receive_count=5,
            ),
        )
        return queue, dlq

    def _function(
        self,
        construct_id: str,
        code: lambda_.Code,
        handler: str,
        memory_mb: int,
        timeout_seconds: int,
        ephemeral_storage_mb: int,
        reserved_concurrency: int,
        environment: dict[str, str],
    ) -> lambda_.Function:
        log_group = logs.LogGroup(
            self,
            f"{construct_id}LogGroup",
            retention=logs.RetentionDays.ONE_MONTH,
            removal_policy=RemovalPolicy.DESTROY,
        )
        return lambda_.Function(
            self,
            construct_id,
            function_name=f"{self.stack_name.lower()}-{construct_id}",
            runtime=lambda_.Runtime.PYTHON_3_12,
            architecture=lambda_.Architecture.X86_64,
            code=code,
            handler=handler,
            memory_size=memory_mb,
            timeout=Duration.seconds(timeout_seconds),
            ephemeral_storage_size=Size.mebibytes(ephemeral_storage_mb),
            reserved_concurrent_executions=reserved_concurrency,
            environment=environment,
            tracing=lambda_.Tracing.ACTIVE,
            log_group=log_group,
        )

    def _add_alarms(
        self,
        http_api: apigwv2.HttpApi,
        functions: tuple[lambda_.Function, ...],
        queue_pairs: tuple[tuple[sqs.Queue, sqs.Queue], ...],
    ) -> None:
        cloudwatch.Alarm(
            self,
            "ApiServerErrorsAlarm",
            metric=cloudwatch.Metric(
                namespace="AWS/ApiGateway",
                metric_name="5xx",
                dimensions_map={"ApiId": http_api.api_id},
                statistic="Sum",
                period=Duration.minutes(5),
            ),
            threshold=5,
            evaluation_periods=1,
        )
        for function in functions:
            for suffix, metric in (
                ("Errors", function.metric_errors()),
                ("Throttles", function.metric_throttles()),
            ):
                cloudwatch.Alarm(
                    self,
                    f"{function.node.id}{suffix}Alarm",
                    metric=metric,
                    threshold=1,
                    evaluation_periods=1,
                )
        for queue, dlq in queue_pairs:
            cloudwatch.Alarm(
                self,
                f"{queue.node.id}AgeAlarm",
                metric=queue.metric_approximate_age_of_oldest_message(),
                threshold=600,
                evaluation_periods=2,
            )
            cloudwatch.Alarm(
                self,
                f"{dlq.node.id}MessagesAlarm",
                metric=dlq.metric_approximate_number_of_messages_visible(),
                threshold=1,
                evaluation_periods=1,
            )
