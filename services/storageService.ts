
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

// --- Cloudflare Worker Code Template ---
export const CLOUDFLARE_WORKER_CODE = `
/**
 * JIRAWALA SYNC WORKER (UPDATED)
 * 
 * STEPS:
 * 1. Create a NEW Worker in Cloudflare named 'jirawala-sync'.
 * 2. In Settings -> Variables, add 'STORE' pointing to a KV Namespace.
 * 3. Paste this code and Deploy.
 */

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
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
    startAutoSync();
    syncData(); 
};

export const getCloudConfigDetails = () => getCloudConfig();

// CRITICAL: This function ensures the local data is marked as "Newer" than anything else.
const touchLocalData = () => {
    const storedTS = localStorage.getItem(STORAGE_KEY_LAST_SYNC);
    const current = storedTS ? parseInt(storedTS) : 0;
    
    // We create a timestamp that is STRICTLY greater than the current one.
    // We also ensure it's at least Date.now() to stay somewhat close to real time,
    // but the priority is being > current.
    const next = Math.max(Date.now(), current + 1);
    
    localStorage.setItem(STORAGE_KEY_LAST_SYNC, next.toString());
    return next;
};

export const syncData = async () => {
    const config = getCloudConfig();
    if (!config || !config.workerUrl) {
        notifyStatus('offline', 'Local Mode');
        return;
    }

    notifyStatus('syncing', 'Syncing...');

    try {
        // 1. Get Local State
        const inventory = getLocalInventory();
        const estimates = getLocalEstimates();
        const localTimestamp = parseInt(localStorage.getItem(STORAGE_KEY_LAST_SYNC) || "0");

        // 2. Fetch Remote State (With Anti-Cache Headers)
        const response = await fetch(config.workerUrl, {
            method: 'GET',
            headers: { 
                'Authorization': config.accessToken,
                'Cache-Control': 'no-cache, no-store'
            }
        });

        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("text/html")) {
            throw new Error("Incorrect URL: You entered the App URL instead of the Sync Worker URL.");
        }

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const remoteData: SyncPayload = await response.json();
        const remoteTimestamp = remoteData.timestamp || 0;
        
        // 3. Compare and Act
        if (remoteTimestamp > localTimestamp) {
            // Remote is newer -> PULL
            console.log(`Pulling from Cloud. Remote: ${remoteTimestamp} > Local: ${localTimestamp}`);
            
            localStorage.setItem(STORAGE_KEY_INVENTORY, JSON.stringify(remoteData.inventory || []));
            localStorage.setItem(STORAGE_KEY_ESTIMATES, JSON.stringify(remoteData.estimates || []));
            localStorage.setItem(STORAGE_KEY_LAST_SYNC, remoteTimestamp.toString());
            
            if (inventoryListener) inventoryListener(remoteData.inventory || []);
            if (estimatesListener) estimatesListener(remoteData.estimates || []);
            notifyStatus('synced', 'Updated from Cloud');
            
        } else if (localTimestamp > remoteTimestamp) {
             // Local is newer -> PUSH
             console.log(`Pushing to Cloud. Local: ${localTimestamp} > Remote: ${remoteTimestamp}`);
             await pushToCloud(config, inventory, estimates);
             
        } else {
             // Equal -> Check if we are possibly in a split brain, but usually assume synced.
             // To be safe, we notify listeners to ensure UI is consistent.
             if (inventoryListener) inventoryListener(inventory);
             if (estimatesListener) estimatesListener(estimates);
             notifyStatus('synced', 'Up to date');
        }

    } catch (error) {
        console.error("Sync failed", error);
        const msg = error instanceof Error ? error.message : "Unknown";
        let displayMsg = msg;
        
        if (msg.includes("Failed to fetch")) displayMsg = "Connection Failed (Check URL)";
        if (msg.includes("JSON")) displayMsg = "Invalid Server Response";
        if (msg.includes("HTTP 500")) displayMsg = "Worker Error (Check Binding)";
        if (msg.includes("Incorrect URL")) displayMsg = msg;

        notifyStatus('error', displayMsg);
    }
};

const pushToCloud = async (config: CloudConfig, inventory: InventoryItem[], estimates: EstimateRecord[]) => {
    // We read the TS again to be sure we are sending the latest decided stamp
    const timestamp = parseInt(localStorage.getItem(STORAGE_KEY_LAST_SYNC) || Date.now().toString());
    const payload: SyncPayload = { inventory, estimates, timestamp };

    const response = await fetch(config.workerUrl, {
        method: 'PUT',
        headers: { 
            'Authorization': config.accessToken,
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store'
        },
        body: JSON.stringify(payload)
    });

    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("text/html")) {
        throw new Error("Incorrect URL: You entered the App URL instead of the Sync Worker URL.");
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    notifyStatus('synced', 'Saved to Cloud');
};

// --- Auto Sync Logic ---
const startAutoSync = () => {
    if (syncIntervalId) clearInterval(syncIntervalId);
    // Sync every 30 seconds
    syncIntervalId = setInterval(() => {
        const config = getCloudConfig();
        if (config?.workerUrl) syncData();
    }, 30000);
};

// --- Public API ---

export const onSyncStatusChange = (cb: (status: SyncStatus, message: string) => void) => {
    statusListener = cb;
    const config = getCloudConfig();
    if (config?.workerUrl) {
        notifyStatus('offline', 'Ready');
        // Initial Sync on Load
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
    
    touchLocalData(); // Bump timestamp
    await syncData(); // Push immediately
};

export const addInventoryBatch = async (items: InventoryItem[]) => {
    const inventory = getLocalInventory();
    
    items.forEach(newItem => {
        if (!newItem.productName) return;

        const idx = inventory.findIndex(i => i.productName.toLowerCase().trim() === newItem.productName.toLowerCase().trim());
        
        if (idx >= 0) {
            const oldStock = inventory[idx].stock;
            inventory[idx] = { 
                ...newItem, 
                id: inventory[idx].id, 
                stock: oldStock + newItem.stock 
            };
        } else {
            inventory.push(newItem);
        }
    });

    localStorage.setItem(STORAGE_KEY_INVENTORY, JSON.stringify(inventory));
    if(inventoryListener) inventoryListener(inventory);
    
    touchLocalData(); 
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
    await syncData();
};

export const deleteEstimateRecord = async (id: string) => {
    let estimates = getLocalEstimates();
    estimates = estimates.filter(e => e.id !== id);
    localStorage.setItem(STORAGE_KEY_ESTIMATES, JSON.stringify(estimates));
    
    if(estimatesListener) estimatesListener(estimates);
    touchLocalData(); 
    await syncData();
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
