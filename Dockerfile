# Base image with Node.js 20 + PowerShell Core for Azure backup collection
FROM node:20

WORKDIR /app

ENV NODE_ENV=production
ENV NPM_CONFIG_LOGLEVEL=warn

# Create azure-monitoring directory with proper permissions for Azure backup collection
RUN mkdir -p /app/azure-monitoring && chown -R node:node /app/azure-monitoring

# Install PowerShell Core (pwsh) for Azure backup collection
RUN apt-get update && apt-get install -y --no-install-recommends wget ca-certificates apt-transport-https && \
    wget -q https://github.com/PowerShell/PowerShell/releases/download/v7.4.6/powershell_7.4.6-1.deb_amd64.deb && \
    dpkg -i powershell_7.4.6-1.deb_amd64.deb 2>/dev/null || apt-get install -f -y && \
    rm -f powershell_7.4.6-1.deb_amd64.deb && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Azure PowerShell modules required by the backup collection script
RUN pwsh -Command "Set-PSRepository -Name PSGallery -InstallationPolicy Trusted" && \
    pwsh -Command "Install-Module -Name Az.Accounts, Az.RecoveryServices, Az.Resources -Scope AllUsers -Force -AllowClobber"

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application code
COPY . .

# Ensure node user owns the app directory
RUN chown -R node:node /app

# Switch to non-root user
USER node

EXPOSE 3000

