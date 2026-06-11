#!/bin/bash

set -ea

ACTION="${1:-get}"
ENV_FILE="/app/data/.env"

# Config spec — field definitions rendered by the StartOS Config UI
config_spec() {
cat << 'EOF'
spec:
  admin_name:
    type: string
    name: Admin Name
    description: Display name for the admin account (created automatically on first start)
    nullable: false
    masked: false
    placeholder: "Eric"
    default: ~
  admin_email:
    type: string
    name: Admin Email
    description: Login email for the admin account
    nullable: false
    masked: false
    placeholder: "you@example.com"
    default: ~
  admin_password:
    type: string
    name: Admin Password
    description: Login password for the admin account (only used to create the account if no users exist)
    nullable: false
    masked: true
    copyable: true
    default: ~
  blink_api_key:
    type: string
    name: Blink API Key
    description: API key from your Blink wallet (blink.sv → API keys). Required to send payments.
    nullable: false
    masked: true
    placeholder: "blink_..."
    default: ~
  employee_deduction_rate:
    type: number
    name: Employee Deduction Rate (%)
    description: Percentage withheld from employee payments (e.g. 10.25 for El Salvador ISSS+AFP)
    nullable: false
    range: "[0,100]"
    default: 10.25
  employer_contribution_rate:
    type: number
    name: Employer Contribution Rate (%)
    description: Additional employer-side contribution sent to the tax authority (e.g. 16.25 for El Salvador)
    nullable: false
    range: "[0,100]"
    default: 16.25
  contractor_withholding_rate:
    type: number
    name: Contractor Withholding Rate (%)
    description: Percentage withheld from contractor payments (e.g. 10 for El Salvador)
    nullable: false
    range: "[0,100]"
    default: 10
  tax_lightning_address:
    type: string
    name: Tax Lightning Address
    description: Lightning address where withheld taxes are automatically sent
    nullable: true
    masked: false
    placeholder: "taxes@blink.sv"
    default: ~
  email_user:
    type: string
    name: Email Address (optional)
    description: Gmail/SMTP address used for password-reset emails
    nullable: true
    masked: false
    placeholder: "your-email@gmail.com"
    default: ~
  email_pass:
    type: string
    name: Email App Password (optional)
    description: Gmail App Password or SMTP password
    nullable: true
    masked: true
    default: ~
  email_host:
    type: string
    name: SMTP Host (optional)
    description: SMTP server hostname
    nullable: true
    masked: false
    placeholder: "smtp.gmail.com"
    default: "smtp.gmail.com"
  email_port:
    type: number
    name: SMTP Port (optional)
    description: SMTP server port
    nullable: true
    range: "[1,65535]"
    default: 587
EOF
}

read_env() {
    # read_env KEY DEFAULT — pull a value out of the saved .env
    local val=""
    if [ -f "$ENV_FILE" ]; then
        val=$(grep "^$1=" "$ENV_FILE" | head -n1 | cut -d'=' -f2-)
    fi
    echo "${val:-$2}"
}

yaml_str() {
    # Quote a value for YAML output, or ~ if empty
    if [ -z "$1" ] || [ "$1" = "~" ]; then echo "~"; else echo "\"$1\""; fi
}

get_config() {
    config_spec
    echo "value:"
    echo "  admin_name: $(yaml_str "$(read_env ADMIN_NAME)")"
    echo "  admin_email: $(yaml_str "$(read_env ADMIN_EMAIL)")"
    echo "  admin_password: $(yaml_str "$(read_env ADMIN_PASSWORD)")"
    echo "  blink_api_key: $(yaml_str "$(read_env BLINK_API_KEY)")"
    echo "  employee_deduction_rate: $(read_env EMPLOYEE_DEDUCTION_RATE 10.25)"
    echo "  employer_contribution_rate: $(read_env EMPLOYER_CONTRIBUTION_RATE 16.25)"
    echo "  contractor_withholding_rate: $(read_env CONTRACTOR_WITHHOLDING_RATE 10)"
    echo "  tax_lightning_address: $(yaml_str "$(read_env TAX_LIGHTNING_ADDRESS)")"
    echo "  email_user: $(yaml_str "$(read_env EMAIL_USER)")"
    echo "  email_pass: $(yaml_str "$(read_env EMAIL_PASS)")"
    echo "  email_host: $(yaml_str "$(read_env EMAIL_HOST smtp.gmail.com)")"
    echo "  email_port: $(read_env EMAIL_PORT 587)"
}

set_config() {
    CONFIG_INPUT=$(cat)

    ADMIN_NAME=$(echo "$CONFIG_INPUT" | yq e '.admin_name // ""' -)
    ADMIN_EMAIL=$(echo "$CONFIG_INPUT" | yq e '.admin_email // ""' -)
    ADMIN_PASSWORD=$(echo "$CONFIG_INPUT" | yq e '.admin_password // ""' -)
    BLINK_API_KEY=$(echo "$CONFIG_INPUT" | yq e '.blink_api_key // ""' -)
    EMP_RATE=$(echo "$CONFIG_INPUT" | yq e '.employee_deduction_rate // 10.25' -)
    EMPLOYER_RATE=$(echo "$CONFIG_INPUT" | yq e '.employer_contribution_rate // 16.25' -)
    CONTRACTOR_RATE=$(echo "$CONFIG_INPUT" | yq e '.contractor_withholding_rate // 10' -)
    TAX_ADDR=$(echo "$CONFIG_INPUT" | yq e '.tax_lightning_address // ""' -)
    EMAIL_USER=$(echo "$CONFIG_INPUT" | yq e '.email_user // ""' -)
    EMAIL_PASS=$(echo "$CONFIG_INPUT" | yq e '.email_pass // ""' -)
    EMAIL_HOST=$(echo "$CONFIG_INPUT" | yq e '.email_host // "smtp.gmail.com"' -)
    EMAIL_PORT=$(echo "$CONFIG_INPUT" | yq e '.email_port // 587' -)

    # Single-quote every value so spaces and special characters survive
    # being sourced by the shell (e.g. Gmail app passwords contain spaces)
    esc() { printf "%s" "$1" | sed "s/'/'\\\\''/g"; }

    mkdir -p "$(dirname "$ENV_FILE")"
    cat > "$ENV_FILE" << EOF
ADMIN_NAME='$(esc "$ADMIN_NAME")'
ADMIN_EMAIL='$(esc "$ADMIN_EMAIL")'
ADMIN_PASSWORD='$(esc "$ADMIN_PASSWORD")'
BLINK_API_KEY='$(esc "$BLINK_API_KEY")'
EMPLOYEE_DEDUCTION_RATE=${EMP_RATE}
EMPLOYER_CONTRIBUTION_RATE=${EMPLOYER_RATE}
CONTRACTOR_WITHHOLDING_RATE=${CONTRACTOR_RATE}
TAX_LIGHTNING_ADDRESS='$(esc "$TAX_ADDR")'
EMAIL_USER='$(esc "$EMAIL_USER")'
EMAIL_PASS='$(esc "$EMAIL_PASS")'
EMAIL_HOST='$(esc "$EMAIL_HOST")'
EMAIL_PORT=${EMAIL_PORT}
PORT=3000
NODE_ENV=production
EOF
    chmod 600 "$ENV_FILE"

    # Required by StartOS — signals successful config save
    echo "depends-on: {}"
}

case "$ACTION" in
    get) get_config ;;
    set) set_config ;;
    *) echo "Usage: $0 [get|set]"; exit 1 ;;
esac
