export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const corsHeaders = {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const kv = env.TEACHING_FEE_KV || env.KV || env.teaching_fee_kv;

    // Helper: Default Users List
    const getDefaultUsers = () => [
      { username: 'admin', password: '12345', role: 'admin', name: 'ผู้ดูแลระบบ (Admin)', createdAt: '2026-09-01T00:00:00.000Z' },
      { username: 'civilutc', password: 'civilutc12345', role: 'user', name: 'สาขาวิชาเทคโนโลยีโยธา', createdAt: '2026-09-01T00:00:00.000Z' }
    ];

    // -------------------------------------------------------------------------
    // 1. API: User Registry & Admin Management (/api/auth/users)
    // -------------------------------------------------------------------------
    if (url.pathname === '/api/auth/users') {
      if (!kv) {
        return new Response(JSON.stringify({ success: true, users: getDefaultUsers(), offline: true }), {
          status: 200,
          headers: corsHeaders
        });
      }

      try {
        // GET: List all users (Admin view)
        if (request.method === 'GET') {
          const raw = await kv.get('teaching_fee_users');
          let users = raw ? JSON.parse(raw) : null;
          if (!users || !Array.isArray(users) || users.length === 0) {
            users = getDefaultUsers();
            await kv.put('teaching_fee_users', JSON.stringify(users));
          } else {
            // Ensure admin and civilutc always exist
            const hasAdmin = users.some(u => u.username === 'admin');
            const hasCivil = users.some(u => u.username === 'civilutc');
            let updated = false;
            if (!hasAdmin) { users.unshift({ username: 'admin', password: '12345', role: 'admin', name: 'ผู้ดูแลระบบ (Admin)', createdAt: '2026-09-01T00:00:00.000Z' }); updated = true; }
            if (!hasCivil) { users.push({ username: 'civilutc', password: 'civilutc12345', role: 'user', name: 'สาขาวิชาเทคโนโลยีโยธา', createdAt: '2026-09-01T00:00:00.000Z' }); updated = true; }
            if (updated) await kv.put('teaching_fee_users', JSON.stringify(users));
          }

          return new Response(JSON.stringify({ success: true, users }), { status: 200, headers: corsHeaders });
        }

        // POST: Register / Add user
        if (request.method === 'POST') {
          const body = await request.json();
          const { username, password, name } = body;

          if (!username || !password) {
            return new Response(JSON.stringify({ success: false, error: 'กรุณากรอก Username และ Password' }), { status: 400, headers: corsHeaders });
          }

          const cleanUser = String(username).trim().toLowerCase();
          const raw = await kv.get('teaching_fee_users');
          let users = raw ? JSON.parse(raw) : getDefaultUsers();

          if (users.some(u => u.username.toLowerCase() === cleanUser)) {
            return new Response(JSON.stringify({ success: false, error: 'Username นี้ถูกใช้งานแล้ว' }), { status: 409, headers: corsHeaders });
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

          return new Response(JSON.stringify({ success: true, user: newUser, message: 'ลงทะเบียนสำเร็จ' }), { status: 200, headers: corsHeaders });
        }

        // PUT: Update user (Suspend / Active / Reset data)
        if (request.method === 'PUT') {
          const body = await request.json();
          const targetUser = (body.username || '').toLowerCase().trim();
          if (!targetUser) {
            return new Response(JSON.stringify({ success: false, error: 'ไม่ระบุ Username' }), { status: 400, headers: corsHeaders });
          }

          const raw = await kv.get('teaching_fee_users');
          let users = raw ? JSON.parse(raw) : getDefaultUsers();
          const idx = users.findIndex(u => u.username.toLowerCase() === targetUser);
          if (idx === -1) {
            return new Response(JSON.stringify({ success: false, error: 'ไม่พบบัญชีผู้ใช้' }), { status: 404, headers: corsHeaders });
          }

          // Handle Action: Reset Data
          if (body.action === 'reset_data') {
            await kv.delete(`teaching_fee_app_data_${targetUser}`);
            return new Response(JSON.stringify({ success: true, message: `ล้างข้อมูลที่กรอกทั้งหมดของ ${targetUser} เรียบร้อยแล้ว` }), { status: 200, headers: corsHeaders });
          }

          // Handle Action: Toggle Suspend
          if (body.status !== undefined) {
            if (targetUser === 'admin') {
              return new Response(JSON.stringify({ success: false, error: 'ไม่สามารถระงับบัญชี Admin ได้' }), { status: 403, headers: corsHeaders });
            }
            users[idx].status = body.status;
            await kv.put('teaching_fee_users', JSON.stringify(users));
            return new Response(JSON.stringify({ success: true, user: users[idx], message: `อัปเดตสถานะของ ${targetUser} เรียบร้อยแล้ว` }), { status: 200, headers: corsHeaders });
          }

          return new Response(JSON.stringify({ success: false, error: 'ไม่มีคำสั่งการแก้ไขที่ถูกต้อง' }), { status: 400, headers: corsHeaders });
        }

        // DELETE: Delete user (Admin action)
        if (request.method === 'DELETE') {
          const targetUser = url.searchParams.get('username')?.toLowerCase()?.trim();
          if (!targetUser) {
            return new Response(JSON.stringify({ success: false, error: 'ไม่ระบุ Username ที่ต้องการลบ' }), { status: 400, headers: corsHeaders });
          }
          if (targetUser === 'admin' || targetUser === 'civilutc') {
            return new Response(JSON.stringify({ success: false, error: 'ไม่สามารถลบบัญชีระบบหลักได้' }), { status: 403, headers: corsHeaders });
          }

          const raw = await kv.get('teaching_fee_users');
          let users = raw ? JSON.parse(raw) : getDefaultUsers();
          users = users.filter(u => u.username.toLowerCase() !== targetUser);

          await kv.put('teaching_fee_users', JSON.stringify(users));
          await kv.delete(`teaching_fee_app_data_${targetUser}`);

          return new Response(JSON.stringify({ success: true, message: `ลบบัญชี ${targetUser} เรียบร้อยแล้ว` }), { status: 200, headers: corsHeaders });
        }

        return new Response(JSON.stringify({ success: false, message: 'Method not allowed' }), { status: 405, headers: corsHeaders });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // -------------------------------------------------------------------------
    // 2. API: Cloud Sync Endpoint (/api/sync) - Multi-user Isolated Storage
    // -------------------------------------------------------------------------
    if (url.pathname === '/api/sync') {
      if (!kv) {
        return new Response(JSON.stringify({
          success: false,
          setupRequired: true,
          message: 'ยังไม่ได้ผูก KV Namespace'
        }), { status: 200, headers: corsHeaders });
      }

      try {
        // Determine user key
        const reqUser = (url.searchParams.get('user') || 'civilutc').toLowerCase().trim();
        const kvKey = reqUser === 'civilutc' ? 'teaching_fee_app_data' : `teaching_fee_app_data_${reqUser}`;

        if (request.method === 'GET') {
          const { value, metadata } = await kv.getWithMetadata(kvKey, 'text');
          if (!value) {
            return new Response(JSON.stringify({
              success: true,
              data: null,
              updatedAt: null,
              user: reqUser,
              message: 'ยังไม่มีข้อมูลบนคลาวด์สำหรับบัญชีนี้'
            }), { status: 200, headers: corsHeaders });
          }

          const parsed = JSON.parse(value);
          return new Response(JSON.stringify({
            success: true,
            data: parsed,
            user: reqUser,
            updatedAt: metadata?.updatedAt || parsed.lastModified || null
          }), { status: 200, headers: corsHeaders });
        }

        if (request.method === 'POST') {
          const body = await request.json();
          const targetUser = (body.user || reqUser || 'civilutc').toLowerCase().trim();
          const targetKey = targetUser === 'civilutc' ? 'teaching_fee_app_data' : `teaching_fee_app_data_${targetUser}`;

          const dataToSave = body.data || body;
          const updatedAt = body.updatedAt || new Date().toISOString();

          if (!dataToSave || typeof dataToSave !== 'object') {
            return new Response(JSON.stringify({ success: false, error: 'รูปแบบข้อมูลไม่ถูกต้อง' }), { status: 400, headers: corsHeaders });
          }

          dataToSave.lastModified = updatedAt;
          await kv.put(targetKey, JSON.stringify(dataToSave), {
            metadata: { updatedAt, user: targetUser }
          });

          return new Response(JSON.stringify({
            success: true,
            user: targetUser,
            updatedAt: updatedAt,
            message: 'บันทึกข้อมูลเรียบร้อยแล้ว'
          }), { status: 200, headers: corsHeaders });
        }

        return new Response(JSON.stringify({ success: false, message: 'Method not allowed' }), { status: 405, headers: corsHeaders });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // -------------------------------------------------------------------------
    // 3. Fallback to Static Assets
    // -------------------------------------------------------------------------
    return env.ASSETS.fetch(request);
  }
};