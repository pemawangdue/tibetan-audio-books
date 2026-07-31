#!/usr/bin/env python3
import os

from aws_cdk import App, Tags, Environment

from stack.dadhep_stack import DadhepStack


app = App()
Tags.of(app).add("project", "dadhep")

DadhepStack(
    app,
    "Dadhep",
    env=Environment(
        account=os.getenv("CDK_DEFAULT_ACCOUNT"),
        region=os.getenv("CDK_DEFAULT_REGION"),
    ),
)
app.synth()
