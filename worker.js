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
    // CORS Headers - Allow all origins for the app to work
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    };

    // Handle CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Check for KV Binding
    if (!env.STORE) {
      return new Response(
        JSON.stringify({ error: "Server Config Error: KV Namespace 'STORE' not bound. Go to Settings -> Variables." }), 
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Check Authorization
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || authHeader.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Missing Token" }), 
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Generate a safe key from the token
    // This allows multiple users to use the same worker if they have different keys
    const KEY = `user_${authHeader.replace(/[^a-zA-Z0-9]/g, '')}`;

    try {
      // GET: Download Data
      if (request.method === "GET") {
        const data = await env.STORE.get(KEY);
        // Return empty structure if no data exists yet
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
        
        // Validate it's JSON
        try {
           JSON.parse(bodyText);
        } catch (e) {
           return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: corsHeaders });
        }
        
        await env.STORE.put(KEY, bodyText);
        
        return new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
      
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err.message }), 
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }
  },
};