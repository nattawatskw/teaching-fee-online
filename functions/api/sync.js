/**
 * Cloudflare Pages Function: /api/sync
 * Provides real-time synchronization between devices using Cloudflare KV.
 */

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json; charset=utf-8'
};

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: CORS_HEADERS
    });
}

function getKVBinding(env) {
    if (!env) return null;
    return env.TEACHING_FEE_KV || env.KV || env.teaching_fee_kv || env.DB || null;
}

function getStorageKey(username) {
    const clean = (username || 'civilutc').toLowerCase().trim();
    return clean === 'civilutc' ? 'teaching_fee_app_data' : `teaching_fee_app_data_${clean}`;
}

export async function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
    });
}

// GET /api/sync - Retrieve latest cloud data or perform lightweight check
export async function onRequestGet(context) {
    const kv = getKVBinding(context.env);

    if (!kv) {
        return jsonResponse({
            success: false,
            setupRequired: true,
            message: "ยังไม่ได้ผูก KV Namespace ใน Cloudflare Pages Settings -> Functions"
        }, 200);
    }

    try {
        const url = new URL(context.request.url);
        const reqUser = (url.searchParams.get('user') || 'civilutc').toLowerCase().trim();
        const kvKey = getStorageKey(reqUser);
        const isCheckOnly = url.searchParams.get('check') === 'true' || url.searchParams.get('checkOnly') === 'true';

        const { value, metadata } = await kv.getWithMetadata(kvKey, 'text');

        if (isCheckOnly) {
            return jsonResponse({
                success: true,
                checkOnly: true,
                hasData: Boolean(value),
                user: reqUser,
                updatedAt: metadata?.updatedAt || null,
                revision: metadata?.revision || 1
            });
        }

        if (!value) {
            return jsonResponse({
                success: true,
                data: null,
                updatedAt: null,
                user: reqUser,
                revision: 0,
                message: "ยังไม่มีข้อมูลบนคลาวด์สำหรับบัญชีนี้"
            });
        }

        const parsed = JSON.parse(value);
        return jsonResponse({
            success: true,
            data: parsed,
            user: reqUser,
            updatedAt: metadata?.updatedAt || parsed.lastModified || null,
            revision: metadata?.revision || 1
        });
    } catch (err) {
        return jsonResponse({
            success: false,
            error: err.message
        }, 500);
    }
}

// POST /api/sync - Save latest data to cloud with conflict protection and automated server backup
export async function onRequestPost(context) {
    const kv = getKVBinding(context.env);

    if (!kv) {
        return jsonResponse({
            success: false,
            setupRequired: true,
            message: "ยังไม่ได้ผูก KV Namespace ใน Cloudflare Pages Settings -> Functions"
        }, 200);
    }

    try {
        const url = new URL(context.request.url);
        const reqUser = (url.searchParams.get('user') || 'civilutc').toLowerCase().trim();
        const body = await context.request.json();
        const targetUser = (body.user || reqUser || 'civilutc').toLowerCase().trim();
        const targetKey = getStorageKey(targetUser);

        const dataToSave = body.data || body;
        const updatedAt = body.updatedAt || new Date().toISOString();
        const baseUpdatedAt = body.baseUpdatedAt;
        const force = Boolean(body.force);

        if (!dataToSave || typeof dataToSave !== 'object') {
            return jsonResponse({
                success: false,
                error: "รูปแบบข้อมูลไม่ถูกต้อง"
            }, 400);
        }

        // Check for existing data & conflict
        const { value: existingVal, metadata: existingMeta } = await kv.getWithMetadata(targetKey, 'text');

        if (!force && baseUpdatedAt && existingMeta?.updatedAt) {
            const existingTime = new Date(existingMeta.updatedAt).getTime();
            const baseTime = new Date(baseUpdatedAt).getTime();
            if (existingTime - baseTime > 2500) {
                return jsonResponse({
                    success: false,
                    conflict: true,
                    serverUpdatedAt: existingMeta.updatedAt,
                    message: "ข้อมูลบนคลาวด์ถูกแก้ไขจากอุปกรณ์อื่นแล้ว กรุณาตรวจสอบก่อนบันทึกทับ"
                }, 200);
            }
        }

        // Automated server backup before overwrite
        if (existingVal) {
            await kv.put(`teaching_fee_backup_${targetUser}_latest`, existingVal, {
                metadata: { backedUpAt: new Date().toISOString(), prevUpdatedAt: existingMeta?.updatedAt || null }
            });
        }

        const nextRevision = (existingMeta?.revision || 0) + 1;
        dataToSave.lastModified = updatedAt;

        await kv.put(targetKey, JSON.stringify(dataToSave), {
            metadata: { updatedAt, user: targetUser, revision: nextRevision }
        });

        return jsonResponse({
            success: true,
            user: targetUser,
            updatedAt: updatedAt,
            revision: nextRevision,
            message: "บันทึกข้อมูลเรียบร้อยแล้ว"
        });
    } catch (err) {
        return jsonResponse({
            success: false,
            error: err.message
        }, 500);
    }
}
