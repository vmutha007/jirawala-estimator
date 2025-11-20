
import { InventoryItem, EstimateRecord, PaymentStatus } from "../types";

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

// --- Cloudflare Worker Code Template ---
export const CLOUDFLARE_WORKER_CODE = `
/**
 * JIRAWALA SYNC WORKER
 * 
 * STEPS:
 * 1. Create a NEW Worker in Cloudflare named 'jirawala-sync'.
 * 2. In Settings -> Variables, add 'STORE' pointing to a KV Namespace.
 * 3. Paste this code and Deploy.
 */

export default {
  async fetch(request, env, ctx) {
    // CORS Headers - allow any origin for simplicity in this private tool
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (!env.STORE) {
        return new Response(
            "SETUP ERROR: KV Namespace 'STORE' not found. Go to Worker Settings -> Variables -> Add Binding 'STORE'.", 
            { status: 500, headers: corsHeaders }
        );
    }

    const authHeader = request.headers.get("Authorization");
    if (!authHeader || authHeader.length < 3) {
        return new Response("Unauthorized", { status: 401, headers: corsHeaders });
    }

    const KEY = \`user_\${authHeader.replace(/[^a-zA-Z0-9]/g, '')}\`; 

    try {
      if (request.method === "GET") {
        const data = await env.STORE.get(KEY);
        return new Response(data || JSON.stringify({ inventory: [], estimates: [], timestamp: 0 }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (request.method === "PUT") {
        const body = await request.json();
        await env.STORE.put(KEY, JSON.stringify(body));
        return new Response(JSON.stringify({ success: true, ts: body.timestamp }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    } catch (err) {
      return new Response(\`Error: \${err.message}\`, { status: 500, headers: corsHeaders });
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
    let cleanUrl = url.trim().replace(/\/$/, ""); 
    if (cleanUrl && !cleanUrl.startsWith("http")) {
        cleanUrl = "https://" + cleanUrl;
    }
    
    localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify({ workerUrl: cleanUrl, accessToken: token.trim() }));
    syncData(); 
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
        // 1. Get Local
        const inventory = getLocalInventory();
        const estimates = getLocalEstimates();
        const localTimestamp = parseInt(localStorage.getItem("jirawala_last_sync_ts") || "0");

        // 2. Fetch Remote
        const response = await fetch(config.workerUrl, {
            method: 'GET',
            headers: { 'Authorization': config.accessToken }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const remoteData: SyncPayload = await response.json();
        
        if (!remoteData.timestamp) {
            // Remote empty -> Push
            await pushToCloud(config, inventory, estimates);
        } else if (remoteData.timestamp > localTimestamp) {
            // Remote newer -> Pull
            localStorage.setItem(STORAGE_KEY_INVENTORY, JSON.stringify(remoteData.inventory || []));
            localStorage.setItem(STORAGE_KEY_ESTIMATES, JSON.stringify(remoteData.estimates || []));
            localStorage.setItem("jirawala_last_sync_ts", remoteData.timestamp.toString());
            
            if (inventoryListener) inventoryListener(remoteData.inventory || []);
            if (estimatesListener) estimatesListener(remoteData.estimates || []);
            notifyStatus('synced', 'Updated from Cloud');
        } else if (localTimestamp > remoteData.timestamp) {
             // Local newer -> Push
             await pushToCloud(config, inventory, estimates);
        } else {
             notifyStatus('synced', 'Up to date');
        }

    } catch (error) {
        console.error("Sync failed", error);
        const msg = error instanceof Error ? error.message : "Unknown";
        let displayMsg = msg;
        if (msg.includes("Failed to fetch")) displayMsg = "Connection Failed (Check URL)";
        if (msg.includes("JSON")) displayMsg = "Invalid Server Response";
        if (msg.includes("HTTP 500")) displayMsg = "Worker Error (Check Binding)";
        
        notifyStatus('error', displayMsg);
    }
};

const pushToCloud = async (config: CloudConfig, inventory: InventoryItem[], estimates: EstimateRecord[]) => {
    const timestamp = Date.now();
    const payload: SyncPayload = { inventory, estimates, timestamp };

    const response = await fetch(config.workerUrl, {
        method: 'PUT',
        headers: { 
            'Authorization': config.accessToken,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

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

export const subscribeToInventory = (cb: (items: InventoryItem[]) => void) => {
    inventoryListener = cb;
    cb(getLocalInventory());
    return () => { inventoryListener = null; };
};

export const subscribeToEstimates = (cb: (items: EstimateRecord[]) => void) => {
    estimatesListener = cb;
    cb(getLocalEstimates());
    return () => { estimatesListener = null; };
};

export const addInventoryItem = async (item: InventoryItem) => {
    const inventory = getLocalInventory();
    // Check if update
    const idx = inventory.findIndex(i => i.id === item.id);
    if(idx >= 0) inventory[idx] = item;
    else inventory.push(item);
    
    localStorage.setItem(STORAGE_KEY_INVENTORY, JSON.stringify(inventory));
    if(inventoryListener) inventoryListener(inventory);
    await syncData();
};

export const addInventoryBatch = async (items: InventoryItem[]) => {
    const inventory = getLocalInventory();
    inventory.push(...items);
    localStorage.setItem(STORAGE_KEY_INVENTORY, JSON.stringify(inventory));
    if(inventoryListener) inventoryListener(inventory);
    await syncData();
};

export const deleteInventoryItem = async (id: string) => {
    let inventory = getLocalInventory();
    inventory = inventory.filter(i => i.id !== id);
    localStorage.setItem(STORAGE_KEY_INVENTORY, JSON.stringify(inventory));
    if(inventoryListener) inventoryListener(inventory);
    await syncData();
};

export const deleteInventoryBatch = async (ids: string[]) => {
    let inventory = getLocalInventory();
    const idSet = new Set(ids);
    inventory = inventory.filter(i => !idSet.has(i.id));
    localStorage.setItem(STORAGE_KEY_INVENTORY, JSON.stringify(inventory));
    if(inventoryListener) inventoryListener(inventory);
    await syncData();
};

export const updateInventoryStock = async (adjustments: {id: string, qtyChange: number}[]) => {
    const inventory = getLocalInventory();
    let changed = false;
    
    adjustments.forEach(adj => {
        const item = inventory.find(i => i.id === adj.id);
        if (item) {
            item.stock = (item.stock || 0) + adj.qtyChange;
            changed = true;
        }
    });

    if (changed) {
        localStorage.setItem(STORAGE_KEY_INVENTORY, JSON.stringify(inventory));
        if (inventoryListener) inventoryListener(inventory);
        // Note: Not waiting for sync here to make UI snappy, sync happens in background via debouncing usually, 
        // but here we just fire and forget for now or rely on next sync.
        syncData(); 
    }
};

export const saveEstimateRecord = async (record: EstimateRecord) => {
    const estimates = getLocalEstimates();
    const idx = estimates.findIndex(e => e.id === record.id);
    if(idx >= 0) estimates[idx] = record;
    else estimates.push(record);
    
    localStorage.setItem(STORAGE_KEY_ESTIMATES, JSON.stringify(estimates));
    if(estimatesListener) estimatesListener(estimates);
    await syncData();
};

export const deleteEstimateRecord = async (id: string) => {
    let estimates = getLocalEstimates();
    estimates = estimates.filter(e => e.id !== id);
    localStorage.setItem(STORAGE_KEY_ESTIMATES, JSON.stringify(estimates));
    if(estimatesListener) estimatesListener(estimates);
    await syncData();
};

export const updateEstimatePaymentStatus = async (id: string, status: PaymentStatus, amountPaid?: number) => {
    const estimates = getLocalEstimates();
    const idx = estimates.findIndex(e => e.id === id);
    if (idx === -1) return;
    
    estimates[idx].paymentStatus = status;
    if (amountPaid !== undefined) estimates[idx].amountPaid = amountPaid;
    estimates[idx].lastModified = Date.now();
    
    localStorage.setItem(STORAGE_KEY_ESTIMATES, JSON.stringify(estimates));
    if (estimatesListener) estimatesListener(estimates);
    
    syncData();
};

export const exportBackup = (inventory: InventoryItem[], estimates: EstimateRecord[]) => {
    const data = { inventory, estimates, timestamp: Date.now() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jirawala_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
};

export const importBackup = async (file: File): Promise<void> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target?.result as string);
                if (Array.isArray(data.inventory) && Array.isArray(data.estimates)) {
                    localStorage.setItem(STORAGE_KEY_INVENTORY, JSON.stringify(data.inventory));
                    localStorage.setItem(STORAGE_KEY_ESTIMATES, JSON.stringify(data.estimates));
                    
                    // Update listeners
                    if(inventoryListener) inventoryListener(data.inventory);
                    if(estimatesListener) estimatesListener(data.estimates);
                    
                    // Force Sync to Cloud
                    await syncData();
                    resolve();
                } else {
                    reject(new Error("Invalid backup format"));
                }
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = reject;
        reader.readAsText(file);
    });
};
