#!/bin/bash

set -ea

# Properties shown on the service page in StartOS
ENV_FILE="/app/data/.env"

TAX_ADDR=""
if [ -f "$ENV_FILE" ]; then
    TAX_ADDR=$(grep "^TAX_LIGHTNING_ADDRESS=" "$ENV_FILE" | cut -d'=' -f2- || true)
fi

cat << EOF
{
  "version": 2,
  "data": {
    "Status": {
      "type": "string",
      "value": "Configured via Config tab. First user to sign up becomes Admin.",
      "description": "Setup status",
      "copyable": false,
      "qr": false,
      "masked": false
    },
    "Tax Lightning Address": {
      "type": "string",
      "value": "${TAX_ADDR:-Not configured}",
      "description": "Where withheld taxes are sent",
      "copyable": true,
      "qr": false,
      "masked": false
    }
  }
}
EOF
