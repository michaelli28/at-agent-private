FROM debian:bookworm-slim

# Avoid prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install dependencies including Chromium
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    xvfb \
    x11vnc \
    fluxbox \
    supervisor \
    net-tools \
    curl \
    git \
    python3 \
    python3-pip \
    novnc \
    websockify \
    chromium \
    chromium-driver \
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-noto-cjk \
    socat \
    && rm -rf /var/lib/apt/lists/*

# Set up display
ENV DISPLAY=:99
ENV RESOLUTION=1280x720x24

# Create directories
RUN mkdir -p /app /var/log/supervisor

# Set up noVNC
RUN ln -s /usr/share/novnc/vnc.html /usr/share/novnc/index.html

# Supervisor configuration
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Expose ports
# 5900 - VNC
# 6080 - noVNC web interface
# 9222 - Chrome DevTools Protocol
EXPOSE 5900 6080 9222

WORKDIR /app

# Start supervisor
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
