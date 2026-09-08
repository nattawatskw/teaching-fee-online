export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. API Cloud Sync Endpoint
    if (url.pathname === '/api/sync') {
      const corsHeaders = {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      };

      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      const kv = env.TEACHING_FEE_KV || env.KV || env.teaching_fee_kv;
      if (!kv) {
        return new Response(JSON.stringify({
          success: false,
          setupRequired: true,
          message: 'ยังไม่ได้ผูก KV Namespace'
        }), { status: 200, headers: corsHeaders });
      }

      try {
        if (request.method === 'GET') {
          const { value, metadata } = await kv.getWithMetadata('teaching_fee_app_data', 'text');
          if (!value) {
            return new Response(JSON.stringify({
              success: true,
              data: null,
              updatedAt: null,
              message: 'ยังไม่มีข้อมูลบนคลาวด์'
            }), { status: 200, headers: corsHeaders });
          }

          const parsed = JSON.parse(value);
          return new Response(JSON.stringify({
            success: true,
            data: parsed,
            updatedAt: metadata?.updatedAt || parsed.lastModified || null
          }), { status: 200, headers: corsHeaders });
        }

        if (request.method === 'POST') {
          const body = await request.json();
          const dataToSave = body.data || body;
          const updatedAt = body.updatedAt || new Date().toISOString();

          if (!dataToSave || typeof dataToSave !== 'object') {
            return new Response(JSON.stringify({ success: false, error: 'รูปแบบข้อมูลไม่ถูกต้อง' }), {
              status: 400,
              headers: corsHeaders
            });
          }

          dataToSave.lastModified = updatedAt;
          await kv.put('teaching_fee_app_data', JSON.stringify(dataToSave), {
            metadata: { updatedAt }
          });

          return new Response(JSON.stringify({
            success: true,
            updatedAt: updatedAt,
            message: 'บันทึกข้อมูลเรียบร้อยแล้ว'
          }), { status: 200, headers: corsHeaders });
        }

        return new Response(JSON.stringify({ success: false, message: 'Method not allowed' }), {
          status: 405,
          headers: corsHeaders
        });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), {
          status: 500,
          headers: corsHeaders
        });
      }
    }

    // 2. Fallback to Static Assets
    return env.ASSETS.fetch(request);
  }
};