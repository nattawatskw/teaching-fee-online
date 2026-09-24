/**
 * Cloudflare Pages Function: /api/auth/users
 */

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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

const getDefaultUsers = () => [
    { username: 'admin', password: '12345', role: 'admin', name: 'ผู้ดูแลระบบ (Admin)', createdAt: '2026-09-01T00:00:00.000Z' },
    { username: 'civilutc', password: 'civilutc12345', role: 'user', name: 'สาขาวิชาเทคโนโลยีโยธา', createdAt: '2026-09-01T00:00:00.000Z' }
];

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
    const kv = getKVBinding(context.env);
    if (!kv) return jsonResponse({ success: true, users: getDefaultUsers(), offline: true });

    try {
        const raw = await kv.get('teaching_fee_users');
        let users = raw ? JSON.parse(raw) : null;
        if (!users || !Array.isArray(users) || users.length === 0) {
            users = getDefaultUsers();
            await kv.put('teaching_fee_users', JSON.stringify(users));
        } else {
            const hasAdmin = users.some(u => u.username === 'admin');
            const hasCivil = users.some(u => u.username === 'civilutc');
            let updated = false;
            if (!hasAdmin) { users.unshift({ username: 'admin', password: '12345', role: 'admin', name: 'ผู้ดูแลระบบ (Admin)', createdAt: '2026-09-01T00:00:00.000Z' }); updated = true; }
            if (!hasCivil) { users.push({ username: 'civilutc', password: 'civilutc12345', role: 'user', name: 'สาขาวิชาเทคโนโลยีโยธา', createdAt: '2026-09-01T00:00:00.000Z' }); updated = true; }
            if (updated) await kv.put('teaching_fee_users', JSON.stringify(users));
        }
        return jsonResponse({ success: true, users });
    } catch (err) {
        return jsonResponse({ success: false, error: err.message }, 500);
    }
}

export async function onRequestPost(context) {
    const kv = getKVBinding(context.env);
    if (!kv) return jsonResponse({ success: false, error: 'ยังไม่ได้ผูก KV' }, 500);

    try {
        const body = await context.request.json();
        const { username, password, name } = body;
        if (!username || !password) return jsonResponse({ success: false, error: 'กรุณากรอก Username และ Password' }, 400);

        const cleanUser = String(username).trim().toLowerCase();
        const raw = await kv.get('teaching_fee_users');
        let users = raw ? JSON.parse(raw) : getDefaultUsers();

        if (users.some(u => u.username.toLowerCase() === cleanUser)) {
            return jsonResponse({ success: false, error: 'Username นี้ถูกใช้งานแล้ว' }, 409);
        }

        const newUser = {
            username: cleanUser,
            password: String(password).trim(),
            role: cleanUser === 'admin' ? 'admin' : 'user',
            name: name ? String(name).trim() : cleanUser,
            createdAt: new Date().toISOString()
        };

        users.push(newUser);
        await kv.put('teaching_fee_users', JSON.stringify(users));
        return jsonResponse({ success: true, user: newUser, message: 'ลงทะเบียนสำเร็จ' });
    } catch (err) {
        return jsonResponse({ success: false, error: err.message }, 500);
    }
}

export async function onRequestPut(context) {
    const kv = getKVBinding(context.env);
    if (!kv) return jsonResponse({ success: false, error: 'ยังไม่ได้ผูก KV' }, 500);

    try {
        const body = await context.request.json();
        const targetUser = (body.username || '').toLowerCase().trim();
        if (!targetUser) return jsonResponse({ success: false, error: 'ไม่ระบุ Username' }, 400);

        const raw = await kv.get('teaching_fee_users');
        let users = raw ? JSON.parse(raw) : getDefaultUsers();
        const idx = users.findIndex(u => u.username.toLowerCase() === targetUser);
        if (idx === -1) return jsonResponse({ success: false, error: 'ไม่พบบัญชีผู้ใช้' }, 404);

        if (body.action === 'reset_data') {
            await kv.delete(`teaching_fee_app_data_${targetUser}`);
            return jsonResponse({ success: true, message: `ล้างข้อมูลที่กรอกทั้งหมดของ ${targetUser} เรียบร้อยแล้ว` });
        }

        if (body.status !== undefined) {
            if (targetUser === 'admin') return jsonResponse({ success: false, error: 'ไม่สามารถระงับบัญชี Admin ได้' }, 403);
            users[idx].status = body.status;
            await kv.put('teaching_fee_users', JSON.stringify(users));
            return jsonResponse({ success: true, user: users[idx], message: `อัปเดตสถานะของ ${targetUser} เรียบร้อยแล้ว` });
        }

        return jsonResponse({ success: false, error: 'ไม่มีคำสั่งการแก้ไขที่ถูกต้อง' }, 400);
    } catch (err) {
        return jsonResponse({ success: false, error: err.message }, 500);
    }
}

export async function onRequestDelete(context) {
    const kv = getKVBinding(context.env);
    if (!kv) return jsonResponse({ success: false, error: 'ยังไม่ได้ผูก KV' }, 500);

    try {
        const url = new URL(context.request.url);
        const targetUser = url.searchParams.get('username')?.toLowerCase()?.trim();
        if (!targetUser) return jsonResponse({ success: false, error: 'ไม่ระบุ Username ที่ต้องการลบ' }, 400);
        if (targetUser === 'admin' || targetUser === 'civilutc') {
            return jsonResponse({ success: false, error: 'ไม่สามารถลบบัญชีระบบหลักได้' }, 403);
        }

        const raw = await kv.get('teaching_fee_users');
        let users = raw ? JSON.parse(raw) : getDefaultUsers();
        users = users.filter(u => u.username.toLowerCase() !== targetUser);

        await kv.put('teaching_fee_users', JSON.stringify(users));
        await kv.delete(`teaching_fee_app_data_${targetUser}`);
        await kv.delete(`teaching_fee_backup_${targetUser}_latest`);

        return jsonResponse({ success: true, message: `ลบบัญชี ${targetUser} เรียบร้อยแล้ว` });
    } catch (err) {
        return jsonResponse({ success: false, error: err.message }, 500);
    }
}
