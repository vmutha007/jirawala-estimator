import { InventoryItem, EstimateRecord } from "../types";

// --- Configuration Constants ---
const STORAGE_KEY_INVENTORY = "jirawala_inventory_data";
const STORAGE_KEY_ESTIMATES = "jirawala_estimates_data";
const STORAGE_KEY_CONFIG = "jirawala_cloud_config";

// --- Types ---
export type SyncStatus = 'offline' | 'syncing' | 'synced' | 'error';

interface CloudConfig {
    workerUrl: string;
    accessToken: string;
}

interface SyncPayload {
    inventory: InventoryItem[];
    estimates: EstimateRecord[];
    timestamp: number;
}

// --- State Management ---
let statusListener: ((status: SyncStatus, message: string) => void) | null = null;
let inventoryListener: ((items: InventoryItem[]) => void) | null = null;
let estimatesListener: ((items: EstimateRecord[]) => void) | null = null;

// --- Cloudflare Worker Code Template (For User Convenience) ---
export const CLOUDFLARE_WORKER_CODE = `
/**
 * JIRAWALA ESTIMATOR - SYNC WORKER
 * 
 * INSTRUCTIONS:
 * 1. Go to Cloudflare Dashboard -> Workers.
 * 2. Create a Worker.
 * 3. Go to Settings -> Variables -> KV Namespace Bindings.
 * 4. Add Binding: Variable name = STORE, KV Namespace = (Select your namespace).
 * 5. Go to 'Edit Code', paste this entire file, and Deploy.
 */

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Check if KV is bound correctly
    if (!env.STORE) {
        return new Response(
            "CONFIGURATION ERROR: KV Namespace 'STORE' is not bound. Go to Worker Settings -> Variables and add a KV Namespace binding named 'STORE'.", 
            { status: 500, headers: corsHeaders }
        );
    }

    const url = new URL(request.url);
    const authHeader = request.headers.get("Authorization");
    
    // SECURITY: Use the key you set in the app
    if (!authHeader || authHeader.length < 5) {
        return new Response("Unauthorized: Invalid or missing Access Token.", { status: 401, headers: corsHeaders });
    }

    const KEY = \`data_\${authHeader}\`; // Partition data by token

    try {
      if (request.method === "GET") {
        const data = await env.STORE.get(KEY);
        return new Response(data || JSON.stringify({ inventory: [], estimates: [], timestamp: 0 }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (request.method === "PUT") {
        const body = await request.json();
        // Save to KV
        await env.STORE.put(KEY, JSON.stringify(body));
        return new Response(JSON.stringify({ success: true, timestamp: body.timestamp }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    } catch (err) {
      return new Response(\`Worker Error: \${err.message}\`, { status: 500, headers: corsHeaders });
    }
  },
};
`;

// --- Internal Helpers ---

const notifyStatus = (status: SyncStatus, msg: string = "") => {
    if (statusListener) statusListener(status, msg);
};

const getLocalInventory = (): InventoryItem[] => {
    const raw = localStorage.getItem(STORAGE_KEY_INVENTORY);
    return raw ? JSON.parse(raw) : [];
};

const getLocalEstimates = (): EstimateRecord[] => {
    const raw = localStorage.getItem(STORAGE_KEY_ESTIMATES);
    return raw ? JSON.parse(raw) : [];
};

const getCloudConfig = (): CloudConfig | null => {
    const raw = localStorage.getItem(STORAGE_KEY_CONFIG);
    return raw ? JSON.parse(raw) : null;
};

// --- Sync Engine ---

export const setCloudConfig = (url: string, token: string) => {
    let cleanUrl = url.trim().replace(/\/$/, ""); // Remove trailing slash
    if (cleanUrl && !cleanUrl.startsWith("http")) {
        cleanUrl = "https://" + cleanUrl;
    }
    
    localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify({ workerUrl: cleanUrl, accessToken: token.trim() }));
    syncData(); // Trigger immediate sync
};

export const getCloudConfigDetails = () => getCloudConfig();

export const syncData = async () => {
    const config = getCloudConfig();
    if (!config || !config.workerUrl) {
        notifyStatus('offline', 'Local Mode');
        return;
    }

    notifyStatus('syncing', 'Syncing...');

    try {
        // 1. Get Local Data
        const inventory = getLocalInventory();
        const estimates = getLocalEstimates();
        
        const localTimestamp = parseInt(localStorage.getItem("jirawala_last_sync_ts") || "0");

        // 2. Fetch Remote Data
        const response = await fetch(config.workerUrl, {
            method: 'GET',
            headers: { 'Authorization': config.accessToken }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || `Server responded with ${response.status}`);
        }

        const remoteData: SyncPayload = await response.json();
        
        if (!remoteData.timestamp) {
            // Remote is empty, push local
            await pushToCloud(config, inventory, estimates);
        } else if (remoteData.timestamp > localTimestamp) {
            // Remote is newer -> PULL
            console.log("Pulling from cloud...");
            localStorage.setItem(STORAGE_KEY_INVENTORY, JSON.stringify(remoteData.inventory || []));
            localStorage.setItem(STORAGE_KEY_ESTIMATES, JSON.stringify(remoteData.estimates || []));
            localStorage.setItem("jirawala_last_sync_ts", remoteData.timestamp.toString());
            
            // Notify UI
            if (inventoryListener) inventoryListener(remoteData.inventory || []);
            if (estimatesListener) estimatesListener(remoteData.estimates || []);
            notifyStatus('synced', 'Updated from Cloud');
        } else if (localTimestamp > remoteData.timestamp) {
             // Local is newer -> PUSH
             await pushToCloud(config, inventory, estimates);
        } else {
             notifyStatus('synced', 'Up to date');
        }

    } catch (error) {
        console.error("Sync failed", error);
        const msg = error instanceof Error ? error.message : "Unknown Error";
        // Clean up common fetch errors for UI
        let displayMsg = msg;
        if (msg.includes("Failed to fetch")) displayMsg = "Network Error (Check URL)";
        if (msg.includes("JSON")) displayMsg = "Invalid Server Response";
        
        notifyStatus('error', displayMsg);
    }
};

const pushToCloud = async (config: CloudConfig, inventory: InventoryItem[], estimates: EstimateRecord[]) => {
    const timestamp = Date.now();
    
    const payload: SyncPayload = {
        inventory,
        estimates,
        timestamp
    };

    const response = await fetch(config.workerUrl, {
        method: 'PUT',
        headers: { 
            'Authorization': config.accessToken,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Server Error ${response.status}`);
    }

    localStorage.setItem("jirawala_last_sync_ts", timestamp.toString());
    notifyStatus('synced', 'Saved to Cloud');
};

// --- Public API ---

export const onSyncStatusChange = (cb: (status: SyncStatus, message: string) => void) => {
    statusListener = cb;
    const config = getCloudConfig();
    if (config?.workerUrl) notifyStatus('offline', 'Ready'); 
    else notifyStatus('offline', 'Local Only');
};

export const subscribeToInventory = (onUpdate: (items: InventoryItem[]) => void) => {
    inventoryListener = onUpdate;
    const data = getLocalInventory();
    onUpdate(data);
    // Initial sync check
    setTimeout(syncData, 1000);
    return () => { inventoryListener = null; };
};

export const subscribeToEstimates = (onUpdate: (items: EstimateRecord[]) => void) => {
    estimatesListener = onUpdate;
    const data = getLocalEstimates();
    onUpdate(data);
    return () => { estimatesListener = null; };
};

// --- CRUD Operations (Always write to Local, then trigger Sync) ---

const triggerAutoSync = () => {
    // Update the local timestamp to ensure we win the conflict resolution
    localStorage.setItem("jirawala_last_sync_ts", Date.now().toString());
    // Debounce sync
    setTimeout(syncData, 500); 
};

export const addInventoryItem = async (item: InventoryItem) => {
    const items = getLocalInventory();
    const idx = items.findIndex(i => i.id === item.id);
    if (idx >= 0) items[idx] = item; else items.unshift(item);
    
    localStorage.setItem(STORAGE_KEY_INVENTORY, JSON.stringify(items));
    if (inventoryListener) inventoryListener(items);
    triggerAutoSync();
};

export const addInventoryBatch = async (newItems: InventoryItem[]) => {
    const current = getLocalInventory();
    const combined = [...newItems, ...current];
    
    localStorage.setItem(STORAGE_KEY_INVENTORY, JSON.stringify(combined));
    if (inventoryListener) inventoryListener(combined);
    triggerAutoSync();
};

export const deleteInventoryItem = async (id: string) => {
    const items = getLocalInventory();
    const newItems = items.filter(i => i.id !== id);
    
    localStorage.setItem(STORAGE_KEY_INVENTORY, JSON.stringify(newItems));
    if (inventoryListener) inventoryListener(newItems);
    triggerAutoSync();
};

export const saveEstimateRecord = async (record: EstimateRecord) => {
    const items = getLocalEstimates();
    const idx = items.findIndex(i => i.id === record.id);
    if (idx >= 0) items[idx] = record; else items.unshift(record);
    
    localStorage.setItem(STORAGE_KEY_ESTIMATES, JSON.stringify(items));
    if (estimatesListener) estimatesListener(items);
    triggerAutoSync();
};

export const deleteEstimateRecord = async (id: string) => {
    const items = getLocalEstimates();
    const newItems = items.filter(i => i.id !== id);
    
    localStorage.setItem(STORAGE_KEY_ESTIMATES, JSON.stringify(newItems));
    if (estimatesListener) estimatesListener(newItems);
    triggerAutoSync();
};

// --- Backup / Restore ---
export const exportBackup = (inventory: InventoryItem[], estimates: EstimateRecord[]) => {
  const backupData = {
    inventory,
    estimates,
    timestamp: new Date().toISOString()
  };
  const dataStr = JSON.stringify(backupData, null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `jirawala_backup_${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export const importBackup = (file: File): Promise<{inventory: InventoryItem[], estimates: EstimateRecord[]}> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        let inv = [], est = [];
        if (Array.isArray(json)) {
            inv = json;
        } else {
            inv = json.inventory || [];
            est = json.estimates || [];
        }
        
        localStorage.setItem(STORAGE_KEY_INVENTORY, JSON.stringify(inv));
        localStorage.setItem(STORAGE_KEY_ESTIMATES, JSON.stringify(est));
        
        if (inventoryListener) inventoryListener(inv);
        if (estimatesListener) estimatesListener(est);
        triggerAutoSync();
        
        resolve({ inventory: inv, estimates: est });
      } catch (err) {
        reject(err);
      }
    };
    reader.readAsText(file);
  });
};