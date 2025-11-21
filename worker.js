
/**
 * JIRAWALA SYNC WORKER
 * 
 * INSTRUCTIONS:
 * 1. Create a Cloudflare Worker named 'jirawala_data' (or similar).
 * 2. Paste this code into worker.js (or index.js).
 * 3. Go to Settings -> Variables.
 * 4. Add a KV Namespace Binding:
 *    - Variable Name: STORE
 *    - KV Namespace: (Create one if you haven't, e.g., 'JIRAWALA_DB')
 * 5. Deploy.
 * 6. Use the Worker URL in the App Settings.
 */

export default {
  async fetch(request, env, ctx) {
    // CORS Headers - Allow all headers to prevent browser blocking custom headers like Cache-Control
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS, HEAD",
      "Access-Control-Allow-Headers": "*", 
      "Access-Control-Max-Age": "86400",
    };

    // Handle CORS Preflight - CRITICAL: Return 200 immediately
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    try {
      const url = new URL(request.url);
      const authHeader = request.headers.get("Authorization");
      const hasAuth = authHeader && authHeader.trim().length > 0;

      // HEALTH CHECK: Root path check.
      // Allows testing the URL in browser (no auth) to see if Worker is up.
      if ((url.pathname === "/" || url.pathname === "") && !hasAuth) {
         const kvStatus = env.STORE ? "Connected" : "Missing Binding (Check Settings -> Variables)";
         return new Response(JSON.stringify({ 
             status: "Online", 
             message: "Jirawala Worker is Active", 
             kv: kvStatus 
         }), {
            headers: { "Content-Type": "application/json", ...corsHeaders }
         });
      }

      // Check for KV Binding
      if (!env.STORE) {
        return new Response(
          JSON.stringify({ error: "Server Config Error: KV Namespace 'STORE' not bound." }), 
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      // Require Authorization for all data operations
      if (!hasAuth) {
        return new Response(
          JSON.stringify({ error: "Unauthorized: Missing Token" }), 
          { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      // Generate a safe key from the token
      const KEY = `user_${authHeader.replace(/[^a-zA-Z0-9]/g, '')}`;

      // GET: Download Data
      if (request.method === "GET") {
        const data = await env.STORE.get(KEY);
        // Default empty payload structure if no data exists
        const payload = data || JSON.stringify({ inventory: [], estimates: [], timestamp: 0 });
        
        return new Response(payload, {
          headers: { 
            "Content-Type": "application/json",
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            ...corsHeaders 
          }
        });
      }

      // PUT: Upload Data
      if (request.method === "PUT") {
        const bodyText = await request.text();
        
        try {
           JSON.parse(bodyText); // Validate JSON
        } catch (e) {
           return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: corsHeaders });
        }
        
        await env.STORE.put(KEY, bodyText);
        
        return new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
      
      return new Response(JSON.stringify({ error: "Method not allowed" }), { 
          status: 405, 
          headers: { "Content-Type": "application/json", ...corsHeaders } 
      });

    } catch (err) {
      // Catch-all for any internal errors to ensure CORS headers are still sent
      return new Response(
        JSON.stringify({ error: `Internal Error: ${err.message}` }), 
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }
  },
};
