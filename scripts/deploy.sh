#!/usr/bin/env bash
# Deploys this repo to the production container app: builds the image in Azure Container Registry,
# points the app at it and waits until the new revision is running and healthy.
# Used by .github/workflows/ci.yml on every merge to master, and by hand with `npm run push-prod`
# after `az login` (from a clean checkout of master: the tag is the commit, the build is the tree).
# The container applies pending Prisma migrations itself when it starts.
set -euo pipefail

ACR_NAME="${ACR_NAME:-acrdisfamstge6bc0b}"
IMAGE_NAME="${IMAGE_NAME:-ruidea-backend}"
CONTAINER_APP="${CONTAINER_APP:-ruidea}"
RESOURCE_GROUP="${RESOURCE_GROUP:-rg-disfam-staging}"
WAIT_SECONDS="${WAIT_SECONDS:-600}"
POLL_SECONDS="${POLL_SECONDS:-10}"

cd "$(dirname "$0")/.."

if [ -z "${IMAGE_TAG:-}" ]; then
	if [ -n "$(git status --porcelain)" ]; then
		echo "The working tree has uncommitted changes; commit or discard them first." >&2
		exit 1
	fi
	IMAGE_TAG="$(git rev-parse --short=7 HEAD)"
fi
IMAGE="$ACR_NAME.azurecr.io/$IMAGE_NAME:$IMAGE_TAG"

echo "Building $IMAGE"
az acr build --registry "$ACR_NAME" --image "$IMAGE_NAME:$IMAGE_TAG" --platform linux/amd64 --file Dockerfile .

echo "Deploying $IMAGE to $CONTAINER_APP"
az containerapp update -n "$CONTAINER_APP" -g "$RESOURCE_GROUP" --image "$IMAGE" --output none

REVISION="$(az containerapp show -n "$CONTAINER_APP" -g "$RESOURCE_GROUP" --query properties.latestRevisionName -o tsv)"
echo "Waiting for revision $REVISION"

deadline=$((SECONDS + WAIT_SECONDS))
while :; do
	states="$(az containerapp revision show -n "$CONTAINER_APP" -g "$RESOURCE_GROUP" --revision "$REVISION" \
		--query "[properties.provisioningState, properties.runningState, properties.healthState]" -o tsv | tr '\n' ' ')"
	read -r provisioning running health <<<"$states"
	echo "provisioning=$provisioning running=$running health=$health"
	case "$provisioning/$running/$health" in
		Provisioned/Running*/Healthy | Provisioned/Running*/None)
			echo "Revision $REVISION is live with $IMAGE"
			exit 0
			;;
		Failed/* | */Failed/* | */Degraded/* | */Stopped/* | */*/Unhealthy)
			echo "Revision $REVISION failed: provisioning=$provisioning running=$running health=$health" >&2
			exit 1
			;;
	esac
	if [ "$SECONDS" -ge "$deadline" ]; then
		echo "Revision $REVISION is not healthy after ${WAIT_SECONDS}s: provisioning=$provisioning running=$running health=$health" >&2
		exit 1
	fi
	sleep "$POLL_SECONDS"
done
