const crypto = require('crypto');

function generateGatewayKey() {
    return `ugk_${crypto.randomBytes(16).toString('hex')}`;
}

function generateAdminToken() {
    return crypto.randomBytes(24).toString('hex');
}

function buildDefaultToml({ gatewayKey, adminToken }) {
    return `preferences.default_mode = "default"
providers = []
bindings = []

[[services]]
id = "default"
name = "Default"
routing_strategy = "round_robin"

# Add providers via admin API or edit this file, then restart the gateway.
# Example DeepSeek (OpenAI-compatible):
# [[providers]]
# name = "deepseek-main"
# provider_type = "openai"
# endpoint_id = "deepseek"
# base_url = "https://api.deepseek.com"
# api_key = "sk-..."
# default_model = "deepseek-chat"
# is_enabled = true
#
# [[bindings]]
# service_id = "default"
# provider_name = "deepseek-main"

[[api_keys]]
key = "${gatewayKey}"
service_id = "default"
is_active = true
qps_limit = 60.0
concurrency_limit = 16
`;
}

module.exports = {
    generateGatewayKey,
    generateAdminToken,
    buildDefaultToml,
};
