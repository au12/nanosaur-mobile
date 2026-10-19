# syntax=docker/dockerfile:1
#
# Nanosaur for the web: builds Iliyas Jorio's Nanosaur source to WebAssembly with the
# web-port patches in this repo, then serves the result with nginx.

ARG EMSDK_VERSION=4.0.10

############################################################################
# The WebAssembly output is the same on every CPU, so always build natively and only vary
# the small nginx runtime image per target platform.
FROM --platform=$BUILDPLATFORM emscripten/emsdk:${EMSDK_VERSION} AS build

ARG NANOSAUR_REPO=https://github.com/jorio/Nanosaur.git
ARG NANOSAUR_COMMIT=29c451b8cedd2febaf0d0d6b09b678e08d42c926
ARG SDL_REPO=https://github.com/libsdl-org/SDL.git
ARG SDL_TAG=release-3.4.4

RUN apt-get update \
	&& apt-get install -y --no-install-recommends cmake make git python3 ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /work

RUN git clone --filter=blob:none "$NANOSAUR_REPO" Nanosaur \
	&& git -C Nanosaur checkout --quiet "$NANOSAUR_COMMIT" \
	&& git -C Nanosaur submodule update --init --recursive \
	&& git clone --depth 1 --branch "$SDL_TAG" "$SDL_REPO" Nanosaur/extern/SDL

COPY patches/ patches/
COPY scripts/ scripts/
RUN PHASE=compile JOBS="$(nproc)" scripts/build-web.sh /work/Nanosaur

COPY tools/ tools/
COPY shell/ shell/
RUN PHASE=assemble scripts/build-web.sh /work/Nanosaur /work/dist

############################################################################
FROM nginx:1.27-alpine

LABEL org.opencontainers.image.title="Nanosaur Web" \
      org.opencontainers.image.description="Pangea Software's Nanosaur (1998), playable in the browser with touch controls and offline PWA support" \
      org.opencontainers.image.licenses="CC-BY-NC-SA-4.0"

COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /work/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
	CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
