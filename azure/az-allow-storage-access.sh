#!/bin/bash

# This script adds or removes the current machine's public IP address to/from Storage Account firewall rules
# to allow or revoke access to the Storage Account from this machine.
#
# Usage:
#   ./allow-storage-access.sh add <storage-account-name> <resource-group-name>
#   ./allow-storage-access.sh revert <storage-account-name> <resource-group-name>

set -e # Exit on error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default values
ACTION="${1}"
BACKEND_STORAGE_ACCOUNT_NAME="${2}"
BACKEND_RESOURCE_GROUP_NAME="${3}"

AZ_TENANT_ID=""
AZ_SUBSCRIPTION_NAME=""
AZ_SUBSCRIPTION_ID=""
AZ_CONTEXT_INITIALIZED=0

load_azure_context() {
  if [ "$AZ_CONTEXT_INITIALIZED" = "1" ]; then
    return
  fi

  local account_info
  account_info=$(az account show --query "{tenantId:tenantId,name:name,id:id}" -o tsv 2>/dev/null || true)

  if [ -n "$account_info" ]; then
    local old_ifs="$IFS"
    IFS=$'\t'
    read -r AZ_TENANT_ID AZ_SUBSCRIPTION_NAME AZ_SUBSCRIPTION_ID <<<"$account_info"
    IFS="$old_ifs"
  fi

  AZ_TENANT_ID=${AZ_TENANT_ID:-unknown}
  AZ_SUBSCRIPTION_NAME=${AZ_SUBSCRIPTION_NAME:-unknown}
  AZ_SUBSCRIPTION_ID=${AZ_SUBSCRIPTION_ID:-unknown}
  AZ_CONTEXT_INITIALIZED=1
}

print_azure_context() {
  load_azure_context
  echo -e "${YELLOW}Current Azure Context:${NC}"
  echo -e "  Tenant ID:        $AZ_TENANT_ID"
  echo -e "  Subscription:     $AZ_SUBSCRIPTION_NAME"
  echo -e "  Subscription ID:  $AZ_SUBSCRIPTION_ID"
}

usage() {
  echo "Usage: $0 <add|revert> <storage-account-name> <resource-group-name>"
  echo ""
  echo "Arguments:"
  echo "  add                   - Add current IP to storage account firewall rules and enable public access"
  echo "  revert                - Remove current IP and disable public network access"
  echo "  storage-account-name  - Name of the storage account"
  echo "  resource-group-name   - Name of the resource group"
  echo ""
  echo "Examples:"
  echo "  $0 add diatfstatestlv2wap terraform-rg-lv2-wap"
  echo "  $0 revert diatfstatestlv2wap terraform-rg-lv2-wap"
  exit 1
}

if [ -z "$ACTION" ] || [ -z "$BACKEND_STORAGE_ACCOUNT_NAME" ] || [ -z "$BACKEND_RESOURCE_GROUP_NAME" ]; then
  echo -e "${RED}Error: Missing required arguments${NC}"
  echo ""
  usage
fi

if [[ "$ACTION" != "add" && "$ACTION" != "revert" ]]; then
  echo -e "${RED}Error: Invalid action '$ACTION'. Must be 'add' or 'revert'${NC}"
  usage
fi

get_public_ip() {
  local ip
  ip=$(curl -s --max-time 10 https://ipinfo.io/ip 2>/dev/null)
  if [ -z "$ip" ]; then
    # Fallback to alternative service
    ip=$(curl -s --max-time 10 https://api.ipify.org 2>/dev/null)
  fi
  if [ -z "$ip" ]; then
    echo -e "${RED}Error: Failed to retrieve public IP address${NC}" >&2
    exit 1
  fi
  echo "$ip"
}

check_azure_cli() {
  if ! command -v az &>/dev/null; then
    echo -e "${RED}Error: Azure CLI is not installed${NC}"
    exit 1
  fi

  if ! az account show &>/dev/null; then
    echo -e "${RED}Error: Not logged in to Azure. Please run 'az login'${NC}"
    exit 1
  fi
}

verify_storage_account_exists() {
  local storage_account=$1
  local resource_group=$2

  echo -e "${YELLOW}Verifying storage account exists...${NC}"

  set +e
  local account_info
  account_info=$(az storage account show \
    --name "$storage_account" \
    --resource-group "$resource_group" \
    --query "{name:name, resourceGroup:resourceGroup, location:location}" \
    -o json 2>&1)
  local exit_code=$?
  set -e

  if [ $exit_code -ne 0 ]; then
    echo -e "${RED}Error: Storage account '$storage_account' not found in resource group '$resource_group'${NC}"
    echo ""
    print_azure_context
    echo ""
    echo -e "${YELLOW}Details:${NC}"
    echo "$account_info"
    echo ""
    echo -e "${YELLOW}Please verify:${NC}"
    echo -e "  • You are in the correct Azure subscription (use 'az account set --subscription <name-or-id>')"
    echo -e "  • The storage account name is correct"
    echo -e "  • The resource group name is correct"
    echo -e "  • You have permissions to access this resource"
    exit 1
  fi

  echo -e "${GREEN}✓ Storage account verified${NC}"
}

show_confirmation() {
  local action=$1
  local storage_account=$2
  local resource_group=$3
  local ip=$4

  load_azure_context

  echo ""
  echo -e "${GREEN}=== Confirmation ===${NC}"
  echo -e "${YELLOW}Action:${NC}              $action"
  echo -e "${YELLOW}Tenant ID:${NC}           $AZ_TENANT_ID"
  echo -e "${YELLOW}Subscription:${NC}        $AZ_SUBSCRIPTION_NAME"
  echo -e "${YELLOW}Subscription ID:${NC}     $AZ_SUBSCRIPTION_ID"
  echo -e "${YELLOW}Storage Account:${NC}     $storage_account"
  echo -e "${YELLOW}Resource Group:${NC}      $resource_group"
  echo -e "${YELLOW}Your IP Address:${NC}     $ip"
  echo ""

  read -p "Do you want to continue? (yes/no): " -r
  echo
  if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    echo -e "${YELLOW}Operation cancelled${NC}"
    exit 0
  fi
}

check_ip_rule_exists() {
  local storage_account=$1
  local resource_group=$2
  local ip=$3

  az storage account network-rule list \
    --account-name "$storage_account" \
    --resource-group "$resource_group" \
    --query "ipRules[?ipAddressOrRange=='$ip'].ipAddressOrRange" -o tsv 2>/dev/null || true
}

add_ip_access() {
  local storage_account=$1
  local resource_group=$2
  local ip=$3

  echo -e "${GREEN}Current network rule set:${NC}"
  az storage account show -n "$storage_account" -g "$resource_group" --query networkRuleSet -o table

  echo ""
  echo -e "${YELLOW}Adding IP $ip to Storage Account firewall...${NC}"
  echo "  Account: $storage_account"
  echo "  Resource Group: $resource_group"

  existing_ip_rule=$(check_ip_rule_exists "$storage_account" "$resource_group" "$ip")

  if [ -n "$existing_ip_rule" ]; then
    echo -e "${YELLOW}IP $ip already exists in firewall rules, skipping add${NC}"
  else
    az storage account network-rule add \
      --account-name "$storage_account" \
      --resource-group "$resource_group" \
      --ip-address "$ip" \
      --output none
    echo -e "${GREEN}✓ IP rule added${NC}"
  fi

  echo -e "${YELLOW}Enabling public network access with default deny...${NC}"
  az storage account update \
    --name "$storage_account" \
    --resource-group "$resource_group" \
    --public-network-access Enabled \
    --default-action Deny \
    --output none
  echo -e "${GREEN}✓ Public access enabled${NC}"

  # Wait for rule propagation
  echo ""
  echo -e "${YELLOW}Waiting for network rule to propagate...${NC}"

  # Verify rule is present in control plane
  if [ -n "$(check_ip_rule_exists "$storage_account" "$resource_group" "$ip")" ]; then
    echo -e "${GREEN}✓ Network rule verified in configuration${NC}"
  fi

  local counter=0
  local sleep_interval=5
  local wait_time=100

  while ! az storage container list --auth-mode login --account-name "$storage_account" --num-results 1 &>/dev/null; do
    counter=$((counter + sleep_interval))
    if [ "$counter" -gt "$wait_time" ]; then
      echo -e "${RED}Error: Timeout waiting for network rule propagation${NC}"
      exit 1
    fi
    echo "  Still waiting... $counter seconds elapsed"
    sleep $sleep_interval
  done

  sleep 2 # Additional wait to ensure propagation across all instances
  echo -e "${GREEN}✓ Network rules propagated successfully${NC}"
  echo ""
  echo -e "${GREEN}Storage account access granted!${NC}"
}

revert_access() {
  local storage_account=$1
  local resource_group=$2
  local ip=$3

  echo -e "${YELLOW}Reverting storage account to private access only...${NC}"
  echo "  Account: $storage_account"
  echo "  Resource Group: $resource_group"
  echo "  Removing IP: $ip"

  existing_ip_rule=$(check_ip_rule_exists "$storage_account" "$resource_group" "$ip")

  if [ -n "$existing_ip_rule" ]; then
    echo -e "${YELLOW}Removing IP from firewall rules...${NC}"
    az storage account network-rule remove \
      --account-name "$storage_account" \
      --resource-group "$resource_group" \
      --ip-address "$ip" \
      --output none
    echo -e "${GREEN}✓ IP rule removed${NC}"
  else
    echo -e "${YELLOW}IP $ip not found in firewall rules, skipping removal${NC}"
  fi

  echo -e "${YELLOW}Disabling public network access...${NC}"
  az storage account update \
    --name "$storage_account" \
    --resource-group "$resource_group" \
    --public-network-access Disabled \
    --output none
  echo -e "${GREEN}✓ Public access disabled${NC}"

  echo ""
  echo -e "${GREEN}Storage account reverted to private access only!${NC}"
}

main() {
  echo -e "${GREEN}=== Storage Account Access Management ===${NC}"
  echo ""

  check_azure_cli
  verify_storage_account_exists "$BACKEND_STORAGE_ACCOUNT_NAME" "$BACKEND_RESOURCE_GROUP_NAME"

  echo -e "${YELLOW}Detecting public IP address...${NC}"
  AGENT_PUBLIC_IP=$(get_public_ip)
  echo -e "${GREEN}Your IP: $AGENT_PUBLIC_IP${NC}"

  show_confirmation "$ACTION" "$BACKEND_STORAGE_ACCOUNT_NAME" "$BACKEND_RESOURCE_GROUP_NAME" "$AGENT_PUBLIC_IP"

  echo ""

  case "$ACTION" in
  add)
    add_ip_access "$BACKEND_STORAGE_ACCOUNT_NAME" "$BACKEND_RESOURCE_GROUP_NAME" "$AGENT_PUBLIC_IP"
    ;;
  revert)
    revert_access "$BACKEND_STORAGE_ACCOUNT_NAME" "$BACKEND_RESOURCE_GROUP_NAME" "$AGENT_PUBLIC_IP"
    ;;
  esac
}

main
