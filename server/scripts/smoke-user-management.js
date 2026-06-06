#!/usr/bin/env node
/** 用户管理模块冒烟：PolicyService + 路由注册 */
require('../src/db/index');
const policy = require('../src/auth/PolicyService');
const platformSettings = require('../src/admin/PlatformSettings');

async function main() {
    const settings = await platformSettings.getAll();
    if (!settings.registration_mode) throw new Error('platform_settings missing registration_mode');
    if (!settings.default_user_quota) throw new Error('platform_settings missing default_user_quota');

    const { db } = require('../src/db/index');
    const schema = require('../src/db/schema');
    const users = await db.select().from(schema.users).limit(1);
    if (users.length > 0) {
        const quota = await policy.getEffectiveQuota(users[0].id);
        if (quota.max_projects == null || quota.usage == null) {
            throw new Error('getEffectiveQuota shape invalid');
        }
    }

    console.log('smoke-user-management: ok');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
