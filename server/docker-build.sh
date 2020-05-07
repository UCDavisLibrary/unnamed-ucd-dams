#! /bin/bash

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd $DIR

SERVER_REPO_HASH=$(git log -1 --pretty=%h .)
SERVER_REPO_TAG=$(git describe $SERVER_REPO_HASH)

docker build \
  --cache-from $UCD_LIB_DOCKER_ORG/$SERVER_NAME:$SERVER_VERSION \
  --build-arg NODE_UTILS_VERSION=${NODE_UTILS_VERSION} \
  --build-arg REPO_HASH=${SERVER_REPO_HASH} \
  --build-arg REPO_TAG=${SERVER_REPO_TAG} \
  -t $UCD_LIB_DOCKER_ORG/$SERVER_NAME:$SERVER_VERSION \
  .