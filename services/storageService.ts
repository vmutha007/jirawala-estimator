
import { InventoryItem, EstimateRecord, PaymentStatus, PaymentEntry, CustomerProfile } from "../types";

// --- Configuration Constants ---
const STORAGE_KEY_INVENTORY = "jirawala_inventory_data";
const STORAGE_KEY_ESTIMATES = "jirawala_estimates_data";
const STORAGE_KEY_CONFIG = "jirawala_cloud_config";
const STORAGE_KEY_LAST_SYNC = "jirawala_last_sync_ts";

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
let syncIntervalId: any = null;
let isSyncing = false; // Prevent double syncs

// --- Cloudflare Worker Code Template ---
export const CLOUDFLARE_WORKER_CODE = `
export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (!env.STORE) {
      return new Response(
        JSON.stringify({ error: "Server Config Error: KV Namespace 'STORE' not bound. Go to Settings -> Variables." }), 
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const authHeader = request.headers.get("Authorization");
    if (!authHeader || authHeader.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Missing Token" }), 
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const KEY = \`user_\${authHeader.replace(/[^a-zA-Z0-9]/g, '')}\`;

    try {
      if (request.method === "GET") {
        const data = await env.STORE.get(KEY);
        const payload = data || JSON.stringify({ inventory: [], estimates: [], timestamp: 0 });
        return new Response(payload, {
          headers: { 
            "Content-Type": "application/json",
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            ...corsHeaders 
          }
        });
      }

      if (request.method === "PUT") {
        const bodyText = await request.text();
        try { JSON.parse(bodyText); } catch (e) {
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

// --- Storage Event Listener (Cross-Tab Sync) ---
window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY_INVENTORY && inventoryListener) {
        inventoryListener(getLocalInventory());
    }
    if (e.key === STORAGE_KEY_ESTIMATES && estimatesListener) {
        estimatesListener(getLocalEstimates());
    }
    if (e.key === STORAGE_KEY_CONFIG) {
        startAutoSync();
        syncData();
    }
});

// --- Visibility Listener (Sync on Tab Focus) ---
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        syncData();
    }
});

window.addEventListener('focus', () => {
    syncData();
});

// --- Sync Engine ---

export const setCloudConfig = (url: string, token: string) => {
    let cleanUrl = url.trim().replace(/\/$/, ""); 
    if (cleanUrl && !cleanUrl.startsWith("http")) {
        cleanUrl = "https://" + cleanUrl;
    }
    
    localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify({ workerUrl: cleanUrl, accessToken: token.trim() }));
    
    startAutoSync();
    syncData(); 
};

export const getCloudConfigDetails = () => getCloudConfig();

const touchLocalData = () => {
    const storedTS = parseInt(localStorage.getItem(STORAGE_KEY_LAST_SYNC) || "0");
    const now = Date.now();
    const next = Math.max(now, storedTS + 1);
    
    localStorage.setItem(STORAGE_KEY_LAST_SYNC, next.toString());
    return next;
};

export const syncData = async () => {
    if (isSyncing) return;
    
    const config = getCloudConfig();
    if (!config || !config.workerUrl) {
        notifyStatus('offline', 'Local Mode');
        return;
    }

    isSyncing = true;
    const spinnerTimeout = setTimeout(() => notifyStatus('syncing', 'Syncing...'), 500);

    try {
        const localTimestamp = parseInt(localStorage.getItem(STORAGE_KEY_LAST_SYNC) || "0");

        // CACHE BUSTING with timestamp
        const bustCache = `?t=${Date.now()}`;
        const fetchUrl = `${config.workerUrl}${bustCache}`;

        const response = await fetch(fetchUrl, {
            method: 'GET',
            headers: { 
                'Authorization': config.accessToken,
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        });

        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("text/html")) {
            throw new Error("Incorrect URL: The Worker returned HTML instead of JSON. Check URL.");
        }

        if (!response.ok) {
            let text = "Unknown Error";
            try { text = await response.text(); } catch(e) {}
            try { 
                const errObj = JSON.parse(text);
                if (errObj.error) text = errObj.error;
            } catch(e) {}
            throw new Error(text);
        }

        const remoteData: SyncPayload = await response.json();
        const remoteTimestamp = remoteData.timestamp || 0;
        
        if (remoteTimestamp > localTimestamp) {
            // Cloud is newer -> PULL
            applyRemoteData(remoteData);
            notifyStatus('synced', 'Loaded from Cloud');
            
        } else if (localTimestamp > remoteTimestamp) {
             // Local is newer -> PUSH
             await pushToCloud(config);
             notifyStatus('synced', 'Saved to Cloud');
        } else {
             notifyStatus('synced', 'Up to date');
        }

    } catch (error) {
        console.error("Sync failed", error);
        const msg = error instanceof Error ? error.message : "Unknown";
        let displayMsg = msg;
        if (msg.includes("Failed to fetch")) displayMsg = "Connection Failed (Check Internet/CORS)";
        notifyStatus('error', displayMsg);
    } finally {
        clearTimeout(spinnerTimeout);
        isSyncing = false;
    }
};

const applyRemoteData = (data: SyncPayload) => {
    localStorage.setItem(STORAGE_KEY_INVENTORY, JSON.stringify(data.inventory || []));
    localStorage.setItem(STORAGE_KEY_ESTIMATES, JSON.stringify(data.estimates || []));
    localStorage.setItem(STORAGE_KEY_LAST_SYNC, (data.timestamp || 0).toString());
    
    if (inventoryListener) inventoryListener(data.inventory || []);
    if (estimatesListener) estimatesListener(data.estimates || []);
};

const pushToCloud = async (config: CloudConfig) => {
    const inventory = getLocalInventory();
    const estimates = getLocalEstimates();
    const timestamp = parseInt(localStorage.getItem(STORAGE_KEY_LAST_SYNC) || Date.now().toString());
    
    const payload: SyncPayload = { inventory, estimates, timestamp };

    const bustCache = `?t=${Date.now()}`;
    const response = await fetch(`${config.workerUrl}${bustCache}`, {
        method: 'PUT',
        headers: { 
            'Authorization': config.accessToken,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
         let text = await response.text();
         throw new Error(`Save Failed: ${text}`);
    }
};

// --- FORCE ACTIONS (Manual Override) ---

export const forceUploadToCloud = async () => {
    const config = getCloudConfig();
    if (!config) throw new Error("Not configured");
    
    touchLocalData();
    notifyStatus('syncing', 'Force Uploading...');
    await pushToCloud(config);
    notifyStatus('synced', 'Force Upload Complete');
};

export const forceDownloadFromCloud = async () => {
    const config = getCloudConfig();
    if (!config) throw new Error("Not configured");

    notifyStatus('syncing', 'Force Downloading...');
    
    const bustCache = `?t=${Date.now()}`;
    const response = await fetch(`${config.workerUrl}${bustCache}`, {
        method: 'GET',
        headers: { 
            'Authorization': config.accessToken,
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        }
    });

    if (!response.ok) throw new Error("Download Failed");
    
    const remoteData: SyncPayload = await response.json();
    applyRemoteData(remoteData);
    notifyStatus('synced', 'Force Download Complete');
};

// --- Auto Sync Logic ---
const startAutoSync = () => {
    if (syncIntervalId) clearInterval(syncIntervalId);
    // 3 second interval for balance of speed and performance
    syncIntervalId = setInterval(() => {
        const config = getCloudConfig();
        if (config?.workerUrl && !isSyncing) syncData();
    }, 3000);
};

// --- Public API ---

export const onSyncStatusChange = (cb: (status: SyncStatus, message: string) => void) => {
    statusListener = cb;
    const config = getCloudConfig();
    if (config?.workerUrl) {
        notifyStatus('offline', 'Connecting...');
        syncData();
        startAutoSync();
    } else {
        notifyStatus('offline', 'Local Only');
    }
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
    let idx = inventory.findIndex(i => i.id === item.id);
    
    if (idx === -1 && item.productName) {
        idx = inventory.findIndex(i => i.productName.toLowerCase().trim() === item.productName.toLowerCase().trim());
    }

    if(idx >= 0) {
        const oldItem = inventory[idx];
        inventory[idx] = { ...item, id: oldItem.id };
    } else {
        inventory.push(item);
    }
    
    localStorage.setItem(STORAGE_KEY_INVENTORY, JSON.stringify(inventory));
    if(inventoryListener) inventoryListener(inventory);
    
    touchLocalData(); 
    notifyStatus('syncing', 'Saving...');
    await syncData();
};

export const addInventoryBatch = async (items: InventoryItem[]) => {
    const inventory = getLocalInventory();
    items.forEach(newItem => {
        if (!newItem.productName) return;
        const idx = inventory.findIndex(i => i.productName.toLowerCase().trim() === newItem.productName.toLowerCase().trim());
        if (idx >= 0) {
            const oldStock = inventory[idx].stock;
            inventory[idx] = { ...newItem, id: inventory[idx].id, stock: oldStock + newItem.stock };
        } else {
            inventory.push(newItem);
        }
    });

    localStorage.setItem(STORAGE_KEY_INVENTORY, JSON.stringify(inventory));
    if(inventoryListener) inventoryListener(inventory);
    touchLocalData(); 
    notifyStatus('syncing', 'Saving Batch...');
    await syncData();
};

export const deleteInventoryItem = async (id: string) => {
    let inventory = getLocalInventory();
    const initialLength = inventory.length;
    inventory = inventory.filter(i => i.id !== id);
    
    if (inventory.length !== initialLength) {
        localStorage.setItem(STORAGE_KEY_INVENTORY, JSON.stringify(inventory));
        if(inventoryListener) inventoryListener(inventory);
        touchLocalData(); 
        notifyStatus('syncing', 'Deleting...');
        await syncData();
    }
};

export const deleteInventoryBatch = async (ids: string[]) => {
    let inventory = getLocalInventory();
    const idSet = new Set(ids);
    const initialLength = inventory.length;
    inventory = inventory.filter(i => !idSet.has(i.id));
    
    if (inventory.length !== initialLength) {
        localStorage.setItem(STORAGE_KEY_INVENTORY, JSON.stringify(inventory));
        if(inventoryListener) inventoryListener(inventory);
        touchLocalData(); 
        notifyStatus('syncing', 'Deleting Batch...');
        await syncData();
    }
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
        touchLocalData(); 
        notifyStatus('syncing', 'Updating Stock...');
        await syncData(); 
    }
};

export const saveEstimateRecord = async (record: EstimateRecord) => {
    const estimates = getLocalEstimates();
    const idx = estimates.findIndex(e => e.id === record.id);
    
    if(idx >= 0) estimates[idx] = record;
    else estimates.push(record);
    
    localStorage.setItem(STORAGE_KEY_ESTIMATES, JSON.stringify(estimates));
    if(estimatesListener) estimatesListener(estimates);
    
    touchLocalData(); 
    notifyStatus('syncing', 'Saving Order...');
    await syncData();
};

export const deleteEstimateRecord = async (id: string) => {
    let estimates = getLocalEstimates();
    const initialLen = estimates.length;
    estimates = estimates.filter(e => e.id !== id);
    
    if (estimates.length !== initialLen) {
        localStorage.setItem(STORAGE_KEY_ESTIMATES, JSON.stringify(estimates));
        if(estimatesListener) estimatesListener(estimates);
        touchLocalData(); 
        notifyStatus('syncing', 'Deleting Order...');
        await syncData();
    }
};

export const updateEstimatePaymentStatus = async (id: string, status: PaymentStatus) => {
    const estimates = getLocalEstimates();
    const idx = estimates.findIndex(e => e.id === id);
    if (idx === -1) return;
    
    estimates[idx].paymentStatus = status;
    estimates[idx].lastModified = Date.now();
    
    localStorage.setItem(STORAGE_KEY_ESTIMATES, JSON.stringify(estimates));
    if (estimatesListener) estimatesListener(estimates);
    
    touchLocalData();
    notifyStatus('syncing', 'Updating Status...');
    await syncData();
};

export const addPaymentToEstimate = async (targetEstId: string, payment: PaymentEntry) => {
    const estimates = getLocalEstimates();
    const targetIdx = estimates.findIndex(e => e.id === targetEstId);
    if (targetIdx === -1) return;

    const targetEst = estimates[targetIdx];
    const getCustKey = (c: CustomerProfile) => (c.firmName || c.name || '').toLowerCase().trim() + (c.phone || '').trim();
    const targetCustKey = getCustKey(targetEst.customer);

    const customerEstimatesIndices = estimates
        .map((e, i) => ({ ...e, originalIndex: i }))
        .filter(e => e.status === 'confirmed' && getCustKey(e.customer) === targetCustKey)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()); 

    let remainingAmount = payment.amount;
    const userNote = payment.note ? `${payment.note} - ` : "";

    const calculateDue = (est: EstimateRecord) => {
        const total = est.items.reduce((s, i) => s + (i.sellingBasic * (1 + i.gstPercent/100) * i.quantity), 0) 
                        + est.additionalCharges.adjustment + est.additionalCharges.packing + est.additionalCharges.shipping;
        const paid = est.paymentHistory ? est.paymentHistory.reduce((s, p) => s + p.amount, 0) : (est.amountPaid || 0);
        return { total, paid, due: total - paid };
    };

    const targetStats = calculateDue(targetEst);
    if (targetStats.due > 0) {
        const pay = Math.min(targetStats.due, remainingAmount);
        if (pay > 0) {
            const newEntry = { 
                ...payment, 
                amount: pay, 
                id: crypto.randomUUID(),
                note: `${userNote}Inv#${targetEst.invoiceNumber || 'Ref'} Payment`
            };
            const est = estimates[targetIdx];
            est.paymentHistory = [...(est.paymentHistory || []), newEntry];
            const newStats = calculateDue(est); 
            est.amountPaid = newStats.paid;
            est.paymentStatus = newStats.paid >= newStats.total - 1 ? 'paid' : 'partial';
            est.lastModified = Date.now();
            remainingAmount -= pay;
        }
    }

    if (remainingAmount > 0) {
        for (const otherEst of customerEstimatesIndices) {
            if (otherEst.id === targetEst.id) continue; 
            const stats = calculateDue(otherEst);
            if (stats.due > 1) {
                const pay = Math.min(stats.due, remainingAmount);
                const newEntry = { 
                    ...payment, 
                    amount: pay, 
                    id: crypto.randomUUID(), 
                    note: `${userNote}Cleared Inv#${otherEst.invoiceNumber || 'Old Dues'}`
                };
                const realIndex = otherEst.originalIndex;
                const est = estimates[realIndex];
                est.paymentHistory = [...(est.paymentHistory || []), newEntry];
                est.amountPaid = (est.amountPaid || 0) + pay; 
                est.paymentStatus = est.amountPaid >= stats.total - 1 ? 'paid' : 'partial';
                est.lastModified = Date.now();
                remainingAmount -= pay;
                if (remainingAmount <= 0) break;
            }
        }
    }

    if (remainingAmount > 0) {
         const est = estimates[targetIdx];
         const newEntry = { 
             ...payment, 
             amount: remainingAmount, 
             id: crypto.randomUUID(),
             note: `${userNote}Advance / Credit`
         };
         est.paymentHistory = [...(est.paymentHistory || []), newEntry];
         const newStats = calculateDue(est);
         est.amountPaid = newStats.paid;
         est.paymentStatus = 'paid'; 
         est.lastModified = Date.now();
    }

    localStorage.setItem(STORAGE_KEY_ESTIMATES, JSON.stringify(estimates));
    if (estimatesListener) estimatesListener(estimates);
    touchLocalData(); 
    notifyStatus('syncing', 'Saving Payment...');
    await syncData();
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
                    
                    if(inventoryListener) inventoryListener(data.inventory);
                    if(estimatesListener) estimatesListener(data.estimates);
                    
                    touchLocalData(); 
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
