#!/bin/bash
# =============================================================================
# GMP App Security Setup Script
# =============================================================================
# This script generates secure random secrets and sets up the .env file
# Run this ONCE before first deployment
# =============================================================================

set -e

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd backend && pwd)"
ENV_FILE="$BACKEND_DIR/.env"
ENV_EXAMPLE="$BACKEND_DIR/.env.example"

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║        GMP App - Security Setup Script                    ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# Check if .env already exists
if [ -f "$ENV_FILE" ]; then
    echo "⚠️  WARNING: .env file already exists!"
    echo "   This will overwrite your existing secrets."
    read -p "   Continue? (y/N): " confirm
    if [[ ! $confirm =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 0
    fi
fi

# Generate secure random secrets
echo "🔐 Generating secure random secrets..."
echo ""

# Function to generate hex string
generate_hex() {
    if command -v openssl &> /dev/null; then
        openssl rand -hex "$1"
    elif command -v node &> /dev/null; then
        node -e "console.log(require('crypto').randomBytes($1).toString('hex'))"
    else
        # Fallback: use /dev/urandom
        head -c "$1" /dev/urandom | xxd -p
    fi
}

JWT_ACCESS_SECRET=$(generate_hex 32)
JWT_REFRESH_SECRET=$(generate_hex 32)
SESSION_SECRET=$(generate_hex 32)

echo "   ✅ JWT Access Secret:    ${JWT_ACCESS_SECRET:0:16}..."
echo "   ✅ JWT Refresh Secret:   ${JWT_REFRESH_SECRET:0:16}..."
echo "   ✅ Session Secret:       ${SESSION_SECRET:0:16}..."
echo ""

# Copy .env.example to .env
echo "📋 Creating .env file from template..."
cp "$ENV_EXAMPLE" "$ENV_FILE"

# Replace placeholders with generated secrets
echo "🔧 Configuring secrets..."

# Use sed for cross-platform compatibility
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    sed -i '' "s|<GENERAR_CON_OPENSSL_RAND_HEX_32>|$JWT_ACCESS_SECRET|g" "$ENV_FILE"
    sed -i '' "s|<TU_USUARIO_IBM_I>|gmp_user|g" "$ENV_FILE"
    sed -i '' "s|<TU_PASSWORD_IBM_I>|CHANGE_ME_IN_PRODUCTION|g" "$ENV_FILE"
    sed -i '' "s|<REDIS_PASSWORD_SI_REQUERIDO>|redis_secure_password|g" "$ENV_FILE"
    sed -i '' "s|<SMTP_PASSWORD_SEGURO>|smtp_secure_password|g" "$ENV_FILE"
    sed -i '' "s|<TU_GOOGLE_MAPS_API_KEY>|your_google_maps_api_key|g" "$ENV_FILE"
else
    # Linux
    sed -i "s|<GENERAR_CON_OPENSSL_RAND_HEX_32>|$JWT_ACCESS_SECRET|g" "$ENV_FILE"
    sed -i "s|<TU_USUARIO_IBM_I>|gmp_user|g" "$ENV_FILE"
    sed -i "s|<TU_PASSWORD_IBM_I>|CHANGE_ME_IN_PRODUCTION|g" "$ENV_FILE"
    sed -i "s|<REDIS_PASSWORD_SI_REQUERIDO>|redis_secure_password|g" "$ENV_FILE"
    sed -i "s|<SMTP_PASSWORD_SEGURO>|smtp_secure_password|g" "$ENV_FILE"
    sed -i "s|<TU_GOOGLE_MAPS_API_KEY>|your_google_maps_api_key|g" "$ENV_FILE"
fi

# Set production-ready defaults
sed -i.bak "s|NODE_ENV=development|NODE_ENV=production|g" "$ENV_FILE" 2>/dev/null || \
sed -i "s|NODE_ENV=development|NODE_ENV=production|g" "$ENV_FILE"

echo "   ✅ .env file created at: $ENV_FILE"
echo ""

# Set restrictive file permissions
echo "🔒 Setting restrictive file permissions..."
chmod 600 "$ENV_FILE"
echo "   ✅ .env permissions set to 600 (owner read/write only)"
echo ""

# Create data directory with secure permissions
DATA_DIR="$BACKEND_DIR/data"
if [ ! -d "$DATA_DIR" ]; then
    mkdir -p "$DATA_DIR"
    chmod 700 "$DATA_DIR"
    echo "   ✅ Data directory created: $DATA_DIR"
fi

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║  ✅ Security Setup Complete!                              ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""
echo "📝 NEXT STEPS:"
echo ""
echo "1. Review and update $ENV_FILE with your actual credentials:"
echo "   - ODBC_UID / ODBC_PWD (IBM i database)"
echo "   - CORS_ORIGINS (your production domain)"
echo "   - SMTP credentials (if sending emails)"
echo "   - Google Maps API key"
echo ""
echo "2. Build TypeScript files:"
echo "   cd backend && npm run build:ts"
echo ""
echo "3. Start the server:"
echo "   npm run start:ts"
echo ""
echo "4. IMPORTANT: Store this .env file securely!"
echo "   - Never commit to version control"
echo "   - Backup to secure secret manager"
echo "   - Rotate secrets periodically"
echo ""
