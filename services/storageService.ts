
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

// Helper to force a push by updating the local timestamp
const touchLocalData = () => {
    const current = parseInt(localStorage.getItem(STORAGE_KEY_LAST_SYNC) || "0");
    // CRITICAL FIX: 
    // Ensure the new timestamp is STRICTLY greater than the last known sync timestamp.
    // This handles clock skew where the device time might be behind the server time.
    // We add 100ms to ensure it wins any race.
    const next = Math.max(Date.now(), current + 100);
    localStorage.setItem(STORAGE_KEY_LAST_SYNC, next.toString());
};

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
        const localTimestamp = parseInt(localStorage.getItem(STORAGE_KEY_LAST_SYNC) || "0");

        // 2. Fetch Remote
        const response = await fetch(config.workerUrl, {
            method: 'GET',
            headers: { 'Authorization': config.accessToken }
        });

        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("text/html")) {
            throw new Error("Incorrect URL: You entered the App URL instead of the Sync Worker URL.");
        }

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
            localStorage.setItem(STORAGE_KEY_LAST_SYNC, remoteData.timestamp.toString());
            
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
        if (msg.includes("Incorrect URL")) displayMsg = msg;

        notifyStatus('error', displayMsg);
    }
};

const pushToCloud = async (config: CloudConfig, inventory: InventoryItem[], estimates: EstimateRecord[]) => {
    // Use current local timestamp which we ensured is > last remote in touchLocalData
    const timestamp = parseInt(localStorage.getItem(STORAGE_KEY_LAST_SYNC) || Date.now().toString());
    const payload: SyncPayload = { inventory, estimates, timestamp };

    const response = await fetch(config.workerUrl, {
        method: 'PUT',
        headers: { 
            'Authorization': config.accessToken,
            'Content-Type': 'application/json'
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
    
    // 1. Try to find by ID (Edit Mode)
    let idx = inventory.findIndex(i => i.id === item.id);
    
    // 2. If not found by ID, check if duplicate name exists
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
    touchLocalData(); // Mark as dirty
    await syncData();
};

export const addInventoryBatch = async (items: InventoryItem[]) => {
    const inventory = getLocalInventory();
    
    items.forEach(newItem => {
        if (!newItem.productName) return;

        const idx = inventory.findIndex(i => i.productName.toLowerCase().trim() === newItem.productName.toLowerCase().trim());
        
        if (idx >= 0) {
            // Add stock to existing
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
    touchLocalData(); // Mark as dirty
    await syncData();
};

export const deleteInventoryItem = async (id: string) => {
    let inventory = getLocalInventory();
    inventory = inventory.filter(i => i.id !== id);
    localStorage.setItem(STORAGE_KEY_INVENTORY, JSON.stringify(inventory));
    
    if(inventoryListener) inventoryListener(inventory);
    touchLocalData(); // Mark as dirty for sync
    await syncData();
};

export const deleteInventoryBatch = async (ids: string[]) => {
    let inventory = getLocalInventory();
    const idSet = new Set(ids);
    inventory = inventory.filter(i => !idSet.has(i.id));
    localStorage.setItem(STORAGE_KEY_INVENTORY, JSON.stringify(inventory));
    
    if(inventoryListener) inventoryListener(inventory);
    touchLocalData(); // Mark as dirty
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
        touchLocalData(); // Mark as dirty
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
    touchLocalData(); // Mark as dirty
    await syncData();
};

export const deleteEstimateRecord = async (id: string) => {
    let estimates = getLocalEstimates();
    estimates = estimates.filter(e => e.id !== id);
    localStorage.setItem(STORAGE_KEY_ESTIMATES, JSON.stringify(estimates));
    
    if(estimatesListener) estimatesListener(estimates);
    touchLocalData(); // Mark as dirty so sync sees the deletion!
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

// --- Smart Payment Allocation ---
export const addPaymentToEstimate = async (targetEstId: string, payment: PaymentEntry) => {
    const estimates = getLocalEstimates();
    const targetIdx = estimates.findIndex(e => e.id === targetEstId);
    if (targetIdx === -1) return;

    const targetEst = estimates[targetIdx];
    
    // Helper to get customer key
    const getCustKey = (c: CustomerProfile) => (c.firmName || c.name || '').toLowerCase().trim() + (c.phone || '').trim();
    const targetCustKey = getCustKey(targetEst.customer);

    // Get all confirmed estimates for this customer to distribute payment
    // Map them to include their original index so we can update the main array correctly
    const customerEstimatesIndices = estimates
        .map((e, i) => ({ ...e, originalIndex: i }))
        .filter(e => e.status === 'confirmed' && getCustKey(e.customer) === targetCustKey)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()); // Oldest first

    let remainingAmount = payment.amount;
    const userNote = payment.note ? `${payment.note} - ` : "";

    // Helper to calculate due amount for any estimate
    const calculateDue = (est: EstimateRecord) => {
        const total = est.items.reduce((s, i) => s + (i.sellingBasic * (1 + i.gstPercent/100) * i.quantity), 0) 
                        + est.additionalCharges.adjustment + est.additionalCharges.packing + est.additionalCharges.shipping;
        // Use history if available, or fallback to amountPaid
        const paid = est.paymentHistory ? est.paymentHistory.reduce((s, p) => s + p.amount, 0) : (est.amountPaid || 0);
        return { total, paid, due: total - paid };
    };

    // Step 1: Pay the Target Invoice first (up to its due amount)
    const targetStats = calculateDue(targetEst);
    if (targetStats.due > 0) {
        const pay = Math.min(targetStats.due, remainingAmount);
        
        // Only add if > 0 (though due > 0 check covers it mostly)
        if (pay > 0) {
            const newEntry = { 
                ...payment, 
                amount: pay, 
                id: crypto.randomUUID(),
                note: `${userNote}Inv#${targetEst.invoiceNumber || 'Ref'} Payment`
            };
            const est = estimates[targetIdx];
            
            est.paymentHistory = [...(est.paymentHistory || []), newEntry];
            
            // Update Status
            const newStats = calculateDue(est); 
            est.amountPaid = newStats.paid;
            est.paymentStatus = newStats.paid >= newStats.total - 1 ? 'paid' : 'partial';
            est.lastModified = Date.now();
            
            remainingAmount -= pay;
        }
    }

    // Step 2: Distribute remaining amount to other unpaid invoices (Oldest First)
    if (remainingAmount > 0) {
        for (const otherEst of customerEstimatesIndices) {
            if (otherEst.id === targetEst.id) continue; // Skip target, already handled

            const stats = calculateDue(otherEst);
            // Check if it has dues (tolerance of 1.0 for float issues)
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
                est.amountPaid = (est.amountPaid || 0) + pay; // Simple addition here works as we just pushed history
                est.paymentStatus = est.amountPaid >= stats.total - 1 ? 'paid' : 'partial';
                est.lastModified = Date.now();

                remainingAmount -= pay;
                if (remainingAmount <= 0) break;
            }
        }
    }

    // Step 3: If there is STILL money left, put it back on the Target Invoice as "Advance"
    if (remainingAmount > 0) {
         const est = estimates[targetIdx];
         const newEntry = { 
             ...payment, 
             amount: remainingAmount, 
             id: crypto.randomUUID(),
             note: `${userNote}Advance / Credit`
         };
         est.paymentHistory = [...(est.paymentHistory || []), newEntry];
         
         // Recalculate to update total paid
         const newStats = calculateDue(est);
         est.amountPaid = newStats.paid;
         est.paymentStatus = 'paid'; // Definitely paid now
         est.lastModified = Date.now();
    }

    localStorage.setItem(STORAGE_KEY_ESTIMATES, JSON.stringify(estimates));
    if (estimatesListener) estimatesListener(estimates);
    touchLocalData(); // Mark as dirty
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
                    
                    touchLocalData(); // Mark as dirty
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
