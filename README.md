# Serverless Framework Lab: AWS Lambda + API Gateway + DynamoDB

## Prerequisites

- [Node.js](https://nodejs.org/) (version ≥ 18)
- [Serverless Framework](https://www.serverless.com/framework/docs/getting-started) (version 3.x)
- Local emulators:
  - `serverless-offline`
  - `serverless-dynamodb`


## Project Setup

```bash
# 1. Create a new Serverless project
serverless create --template aws-nodejs --path serverless-lab

# 2. Navigate into the project directory
cd serverless-lab

# 3. Initialize npm and install dependencies
npm init -y
npm install aws-sdk uuid serverless-offline serverless-dynamodb-local

# 4. Install DynamoDB Local (downloads DynamoDB jar locally)
serverless dynamodb install

# 5. Start local DynamoDB instance
serverless dynamodb start

# 6. Start local API Gateway and Lambda emulator
serverless offline start

# 7. To allow the Serverless Framework to deploy services to AWS,  need to configure  AWS credentials locally
serverless config credentials --provider aws --key YOUR_ACCESS_KEY_ID --secret YOUR_SECRET_ACCESS_KEY

# 8. Deploy all functions, API Gateway, and DynamoDB tables to AWS
serverless deploy

# 9. Remove all deployed services from AWS
serverless remove

# Serverless Framework Lab6: AWS Lambda + AWS SQS + DynamoDB

## Additional Setup: AWS CLI, Docker & Local SQS

### Configure AWS CLI
To enable deployment to AWS, configure credentials locally:

```bash
aws configure

## Run Local SQS via Docker

To emulate AWS SQS locally, run [ElasticMQ](https://github.com/softwaremill/elasticmq) in a Docker container:

```bash
docker run --rm -it -p 9324:9324 -p 9325:9325 softwaremill/elasticmq


