/**
 * Cloudflare Pages Function: /api/sync
 * Provides real-time synchronization between devices using Cloudflare KV.
 */

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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

export async function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
    });
}

// GET /api/sync - Retrieve latest cloud data
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
        const { value, metadata } = await kv.getWithMetadata('teaching_fee_app_data', 'text');
        if (!value) {
            return jsonResponse({
                success: true,
                data: null,
                updatedAt: null,
                message: "ยังไม่มีข้อมูลบนคลาวด์"
            });
        }

        const parsed = JSON.parse(value);
        return jsonResponse({
            success: true,
            data: parsed,
            updatedAt: metadata?.updatedAt || parsed.lastModified || null
        });
    } catch (err) {
        return jsonResponse({
            success: false,
            error: err.message
        }, 500);
    }
}

// POST /api/sync - Save latest data to cloud
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
        const body = await context.request.json();
        const dataToSave = body.data || body;
        const updatedAt = body.updatedAt || new Date().toISOString();

        if (!dataToSave || typeof dataToSave !== 'object') {
            return jsonResponse({
                success: false,
                error: "รูปแบบข้อมูลไม่ถูกต้อง"
            }, 400);
        }

        dataToSave.lastModified = updatedAt;

        await kv.put('teaching_fee_app_data', JSON.stringify(dataToSave), {
            metadata: { updatedAt }
        });

        return jsonResponse({
            success: true,
            message: "บันทึกข้อมูลขึ้นคลาวด์เรียบร้อยแล้ว",
            updatedAt
        });
    } catch (err) {
        return jsonResponse({
            success: false,
            error: err.message
        }, 500);
    }
}
