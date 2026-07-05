const crypto = require('crypto');
const { eq, and, desc } = require('drizzle-orm');
const { db } = require('../db/index');
const schema = require('../db/schema');
const { RuntimeError } = require('./interfaces');
const {
    AGENT_BOX_IMAGE_CATALOG,
    getAgentBoxInstallCommand,
    imageRegistry,
    resolveAgentBoxImageDefault,
    resolveBoxBaseImage,
} = require('./agentBoxImages');

function formatVersionRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        agent_id: row.agentId,
        image_ref: row.imageRef,
        tag: row.tag,
        digest: row.digest || null,
        status: row.status,
        is_active: Boolean(row.isActive),
        built_at: row.builtAt || null,
        notes: row.notes || null,
        created_by: row.createdBy || null,
        created_at: row.createdAt,
    };
}

function getCatalogEntry(agentId) {
    return AGENT_BOX_IMAGE_CATALOG[agentId] || null;
}

function isAgentBoxBuildable(agentId) {
    const catalog = getCatalogEntry(agentId);
    if (catalog?.buildable === false) return false;
    return Boolean(getAgentBoxInstallCommand(agentId));
}

function buildDefaultImageRef(agentId, tag) {
    const catalog = getCatalogEntry(agentId);
    const imageTag = catalog?.tag || agentId;
    const versionTag = String(tag || 'latest').trim() || 'latest';
    return `${imageRegistry()}/agent-${imageTag}:${versionTag}`;
}

function normalizeTag(tag) {
    const value = String(tag || '').trim();
    if (!value) {
        throw new RuntimeError('tag is required', 400);
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
        throw new RuntimeError('tag contains invalid characters', 400);
    }
    return value;
}

function normalizeImageRef(imageRef) {
    const value = String(imageRef || '').trim();
    if (!value) {
        throw new RuntimeError('image_ref is required', 400);
    }
    if (value.includes('\0') || /\s/.test(value)) {
        throw new RuntimeError('image_ref contains invalid characters', 400);
    }
    if (value.length > 512) {
        throw new RuntimeError('image_ref is too long', 400);
    }
    return value;
}

async function listAgentBoxImageCatalog() {
    const agents = await db.select().from(schema.agents);
    const versions = await db.select().from(schema.agentBoxImages).orderBy(desc(schema.agentBoxImages.createdAt));
    const versionsByAgent = new Map();
    for (const row of versions) {
        const list = versionsByAgent.get(row.agentId) || [];
        list.push(formatVersionRow(row));
        versionsByAgent.set(row.agentId, list);
    }

    return agents.map((agent) => {
        const catalog = getCatalogEntry(agent.id);
        const agentVersions = versionsByAgent.get(agent.id) || [];
        const activeVersion = agentVersions.find((entry) => entry.is_active) || null;
        const buildable = isAgentBoxBuildable(agent.id);
        return {
            agent_id: agent.id,
            agent_name: agent.name,
            buildable,
            build_skip_reason: catalog?.buildable === false ? (catalog.reason || 'not buildable') : null,
            suggested_image_ref: buildable ? buildDefaultImageRef(agent.id, 'latest') : null,
            default_image_ref: buildable ? resolveAgentBoxImageDefault(agent.id) : null,
            active_version: activeVersion,
            versions: agentVersions,
        };
    });
}

async function getActiveImageRef(agentId) {
    if (!agentId) return null;
    const rows = await db.select().from(schema.agentBoxImages)
        .where(and(
            eq(schema.agentBoxImages.agentId, agentId),
            eq(schema.agentBoxImages.isActive, true),
            eq(schema.agentBoxImages.status, 'ready'),
        ));
    return rows[0]?.imageRef || null;
}

async function registerVersion({
    agentId,
    tag,
    imageRef,
    digest,
    notes,
    builtAt,
    createdBy,
    setActive = false,
}) {
    const agentRows = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId));
    if (agentRows.length === 0) {
        throw new RuntimeError('Agent not found', 404);
    }
    if (!isAgentBoxBuildable(agentId)) {
        throw new RuntimeError('This agent does not support boxlite image builds', 400);
    }

    const normalizedTag = normalizeTag(tag);
    const resolvedImageRef = normalizeImageRef(imageRef || buildDefaultImageRef(agentId, normalizedTag));

    const now = Date.now();
    const id = `img_${crypto.randomBytes(6).toString('hex')}`;
    const payload = {
        id,
        agentId,
        imageRef: resolvedImageRef,
        tag: normalizedTag,
        digest: digest?.trim() || null,
        status: 'ready',
        isActive: false,
        builtAt: Number.isFinite(Number(builtAt)) ? Number(builtAt) : now,
        notes: notes?.trim() || null,
        createdBy: createdBy || null,
        createdAt: now,
    };

    try {
        await db.insert(schema.agentBoxImages).values(payload);
    } catch (err) {
        if (/UNIQUE constraint failed/i.test(String(err))) {
            throw new RuntimeError(`Version tag "${normalizedTag}" already exists for this agent`, 409);
        }
        throw err;
    }

    if (setActive) {
        await activateVersion(id, createdBy);
    }

    const rows = await db.select().from(schema.agentBoxImages).where(eq(schema.agentBoxImages.id, id));
    return formatVersionRow(rows[0]);
}

async function activateVersion(versionId, actorId = null) {
    const rows = await db.select().from(schema.agentBoxImages).where(eq(schema.agentBoxImages.id, versionId));
    if (rows.length === 0) {
        throw new RuntimeError('Image version not found', 404);
    }
    const row = rows[0];
    if (row.status === 'deprecated') {
        throw new RuntimeError('Deprecated image versions cannot be activated', 409);
    }

    await db.update(schema.agentBoxImages)
        .set({ isActive: false })
        .where(eq(schema.agentBoxImages.agentId, row.agentId));

    await db.update(schema.agentBoxImages)
        .set({
            isActive: true,
            status: 'ready',
        })
        .where(eq(schema.agentBoxImages.id, versionId));

    const updated = await db.select().from(schema.agentBoxImages).where(eq(schema.agentBoxImages.id, versionId));
    return formatVersionRow(updated[0]);
}

async function deprecateVersion(versionId) {
    const rows = await db.select().from(schema.agentBoxImages).where(eq(schema.agentBoxImages.id, versionId));
    if (rows.length === 0) {
        throw new RuntimeError('Image version not found', 404);
    }
    const row = rows[0];
    await db.update(schema.agentBoxImages)
        .set({
            status: 'deprecated',
            isActive: false,
        })
        .where(eq(schema.agentBoxImages.id, versionId));
    const updated = await db.select().from(schema.agentBoxImages).where(eq(schema.agentBoxImages.id, versionId));
    return formatVersionRow(updated[0]);
}

module.exports = {
    buildDefaultImageRef,
    formatVersionRow,
    getActiveImageRef,
    isAgentBoxBuildable,
    listAgentBoxImageCatalog,
    registerVersion,
    activateVersion,
    deprecateVersion,
    resolveBoxBaseImage,
};
