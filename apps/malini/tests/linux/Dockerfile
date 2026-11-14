FROM node:24-bookworm-slim AS node

FROM ubuntu:24.04
COPY --from=node /usr/local/ /usr/local/
RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		bubblewrap ca-certificates curl dbus-x11 fonts-dejavu-core fonts-liberation \
		fonts-noto-color-emoji g++ git gnome-keyring libasound2t64 libgbm1 libgtk-3-0t64 \
		libnotify4 libnss3 libsecret-1-0 libxss1 libxtst6 make procps python3 xauth xdg-utils \
		xvfb xz-utils unzip zip \
	&& rm -rf /var/lib/apt/lists/* \
	&& corepack enable pnpm \
	&& install -d -o ubuntu -g ubuntu /home/ubuntu/.cache /home/ubuntu/.local/share/pnpm
ENV HOME=/home/ubuntu LANG=C.UTF-8 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
COPY inside.sh /usr/local/bin/malini-linux
ENTRYPOINT ["/usr/local/bin/malini-linux"]
