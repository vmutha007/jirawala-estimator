
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Upload, 
  Trash2, 
  Download, 
  UploadCloud,
  Plus,
  Search,
  Eye,
  EyeOff,
  Printer,
  Calculator,
  Settings,
  X,
  Image as ImageIcon,
  FileText,
  Save,
  Pencil,
  ChevronDown,
  ChevronUp,
  History,
  Users,
  CheckCircle,
  FileClock,
  Filter,
  ArrowUpDown,
  Database,
  FilePlus,
  Calendar,
  Wifi,
  WifiOff,
  AlertCircle,
  Copy,
  Server,
  Globe,
  Key,
  RefreshCw,
  Smartphone,
  RotateCcw,
  Share2,
  CheckSquare,
  Square,
  Info,
  LayoutDashboard,
  TrendingUp,
  Package,
  AlertTriangle,
  IndianRupee,
  MessageCircle,
  Wallet
} from 'lucide-react';
import { InventoryItem, EstimateItem, BusinessProfile, CustomerProfile, EstimateRecord, EstimateStatus, PaymentStatus } from './types';
import { parseInvoicePDF } from './services/geminiService';
import { 
    subscribeToInventory, 
    subscribeToEstimates, 
    addInventoryItem, 
    deleteInventoryItem, 
    deleteInventoryBatch,
    addInventoryBatch,
    updateInventoryStock,
    saveEstimateRecord,
    deleteEstimateRecord,
    updateEstimatePaymentStatus,
    exportBackup, 
    importBackup,
    onSyncStatusChange,
    SyncStatus,
    setCloudConfig,
    getCloudConfigDetails,
    CLOUDFLARE_WORKER_CODE,
    syncData
} from './services/storageService';
import { generateEstimatePDF } from './services/pdfService';

// Simple helper for UI display
const numberToWordsSimple = (num: number): string => {
    const format = new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    });
    return format.format(num);
};

// Helper to handle "empty" inputs for numbers
const valOrEmpty = (num: number): string | number => {
    return num === 0 ? '' : num;
};

// --- Toast Types ---
interface Toast {
    id: string;
    message: string;
    type: 'success' | 'error' | 'info';
}

function App() {
  // --- State ---
  const [activeTab, setActiveTab] = useState<'dashboard' | 'inventory' | 'estimate' | 'clients'>('dashboard');
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [estimates, setEstimates] = useState<EstimateRecord[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Toast State
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Inventory Selection
  const [selectedInventory, setSelectedInventory] = useState<Set<string>>(new Set());
  
  // Sync Status
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('offline');
  const [syncMessage, setSyncMessage] = useState('');

  // Business Profile State
  const [showSettings, setShowSettings] = useState(false);
  const [businessProfile, setBusinessProfile] = useState<BusinessProfile>({
    name: 'Jirawala Axis',
    address: '',
    gstin: '',
    phone: '',
    email: '',
    logoUrl: '',
    terms: ''
  });
  
  // Cloud Config State
  const [cloudUrl, setCloudUrl] = useState('');
  const [cloudToken, setCloudToken] = useState('');
  
  // Inventory Modal State (Add/Edit)
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [manualItem, setManualItem] = useState<Partial<InventoryItem>>({
    date: new Date().toISOString().split('T')[0],
    gstPercent: 18,
    purchaseDiscountPercent: 0,
    mrp: 0,
    landingPrice: 0,
    stock: 0
  });
  
  // Estimate State
  const [currentEstimateId, setCurrentEstimateId] = useState<string | null>(null);
  const [customerDetails, setCustomerDetails] = useState<CustomerProfile>({
      name: '',
      firmName: '',
      phone: '',
      address: '',
      gstin: ''
  });
  const [showCustomerExtras, setShowCustomerExtras] = useState(false);

  const [estimateItems, setEstimateItems] = useState<EstimateItem[]>([]);
  const [viewMode, setViewMode] = useState<'editor' | 'client'>('editor');
  const [additionalCharges, setAdditionalCharges] = useState({
    packing: 0,
    shipping: 0,
    adjustment: 0
  });
  
  // Search State
  const [searchTerm, setSearchTerm] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // Customer Autocomplete State
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  const clientSearchRef = useRef<HTMLDivElement>(null);

  // Clients Tab State
  const [clientHistorySearch, setClientHistorySearch] = useState('');
  const [clientFilterDate, setClientFilterDate] = useState('');
  const [clientSort, setClientSort] = useState<'date_desc' | 'date_asc' | 'amt_desc' | 'amt_asc'>('date_desc');

  // --- Dashboard Stats ---
  const dashboardStats = useMemo(() => {
      const currentMonth = new Date().getMonth();
      const currentYear = new Date().getFullYear();
      
      const confirmedEstimates = estimates.filter(e => 
          e.status === 'confirmed' && 
          new Date(e.date).getMonth() === currentMonth && 
          new Date(e.date).getFullYear() === currentYear
      );

      const totalSales = confirmedEstimates.reduce((acc, est) => {
          const estTotal = est.items.reduce((sum, i) => sum + (i.sellingBasic * (1 + i.gstPercent/100) * i.quantity), 0);
          return acc + estTotal + est.additionalCharges.adjustment;
      }, 0);

      const totalProfit = confirmedEstimates.reduce((acc, est) => {
          const estProfit = est.items.reduce((sum, i) => sum + ((i.sellingBasic - i.landingPrice) * i.quantity), 0);
          return acc + estProfit + est.additionalCharges.adjustment;
      }, 0);

      const lowStockItems = inventory.filter(i => i.stock < 10);
      
      // Top Items
      const itemSales: Record<string, number> = {};
      estimates.filter(e => e.status === 'confirmed').forEach(est => {
          est.items.forEach(i => {
              itemSales[i.productName] = (itemSales[i.productName] || 0) + i.quantity;
          });
      });
      const topItems = Object.entries(itemSales)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 5)
          .map(([name, qty]) => ({ name, qty }));

      return {
          totalSales,
          totalProfit,
          orderCount: confirmedEstimates.length,
          lowStockItems,
          topItems
      };
  }, [estimates, inventory]);

  // --- Toast Helper ---
  const addToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
      const id = crypto.randomUUID();
      setToasts(prev => [...prev, { id, message, type }]);
      setTimeout(() => {
          setToasts(prev => prev.filter(t => t.id !== id));
      }, 3000);
  };

  // --- Lifecycle ---
  useEffect(() => {
    const unsubInventory = subscribeToInventory(setInventory);
    const unsubEstimates = subscribeToEstimates(setEstimates);
    
    // Status Listener
    onSyncStatusChange((status, msg) => {
        setSyncStatus(status);
        setSyncMessage(msg);
    });

    const savedProfile = localStorage.getItem('business_profile');
    if (savedProfile) {
      setBusinessProfile(JSON.parse(savedProfile));
    }

    const cloudConfig = getCloudConfigDetails();
    if (cloudConfig) {
        setCloudUrl(cloudConfig.workerUrl);
        setCloudToken(cloudConfig.accessToken);
    }

    return () => {
        unsubInventory();
        unsubEstimates();
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('business_profile', JSON.stringify(businessProfile));
  }, [businessProfile]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
      if (clientSearchRef.current && !clientSearchRef.current.contains(event.target as Node)) {
        setShowClientSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // --- Business Profile Logic ---
  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        setBusinessProfile(prev => ({ ...prev, logoUrl: evt.target?.result as string }));
        addToast("Logo uploaded successfully");
      };
      reader.readAsDataURL(file);
    }
  };
  
  const saveSettings = () => {
     if (cloudUrl) {
        setCloudConfig(cloudUrl, cloudToken || 'default-key');
     }
     setShowSettings(false);
     addToast("Settings saved");
  };

  const copyWorkerCode = () => {
      navigator.clipboard.writeText(CLOUDFLARE_WORKER_CODE);
      addToast("Worker Code Copied to Clipboard!", 'success');
  };

  // --- Inventory Logic ---
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    addToast("Analyzing PDF...", 'info');
    try {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        const base64 = (evt.target?.result as string).split(',')[1];
        const parsed = await parseInvoicePDF(base64);
        
        const newItems: InventoryItem[] = parsed.map(item => ({
          id: crypto.randomUUID(),
          productName: item.productName || "Unknown Item",
          vendor: item.vendor || "Unknown Vendor",
          date: item.date || new Date().toISOString().split('T')[0],
          mrp: item.mrp || 0,
          purchaseDiscountPercent: item.purchaseDiscountPercent || 0,
          gstPercent: item.gstPercent || 0,
          landingPrice: item.landingPrice || 0,
          stock: item.stock || 0,
          note: ''
        }));

        await addInventoryBatch(newItems);
        setIsProcessing(false);
        addToast(`Successfully added ${newItems.length} items to stock!`, 'success');
      };
      reader.readAsDataURL(file);
    } catch (error) {
      addToast("Failed to parse PDF. Please try a clearer file.", 'error');
      setIsProcessing(false);
    }
  };

  const openAddModal = () => {
      setManualItem({
        date: new Date().toISOString().split('T')[0],
        gstPercent: 18,
        purchaseDiscountPercent: 0,
        mrp: 0,
        landingPrice: 0,
        stock: 0,
        productName: '',
        vendor: '',
        note: '',
        id: undefined 
      });
      setShowManualAdd(true);
  };

  const openEditModal = (item: InventoryItem) => {
      setManualItem({ ...item });
      setShowManualAdd(true);
  };

  const handleManualInventorySave = async () => {
    if (!manualItem.productName) {
        addToast("Product Name is required", 'error');
        return;
    }

    const newItem: InventoryItem = {
        id: manualItem.id || crypto.randomUUID(),
        productName: manualItem.productName,
        vendor: manualItem.vendor || 'Manual Entry',
        date: manualItem.date || new Date().toISOString().split('T')[0],
        mrp: Number(manualItem.mrp) || 0,
        purchaseDiscountPercent: Number(manualItem.purchaseDiscountPercent) || 0,
        gstPercent: Number(manualItem.gstPercent) || 0,
        landingPrice: Number(manualItem.landingPrice) || 0,
        stock: Number(manualItem.stock) || 0,
        note: manualItem.note || ''
    };

    await addInventoryItem(newItem);
    setShowManualAdd(false);
    addToast(manualItem.id ? "Item Updated" : "Item Added", 'success');
  };

  const handleDeleteInventory = async (id: string, e?: React.MouseEvent) => {
    if(e) e.stopPropagation();
    if(confirm("Delete this item?")) {
        await deleteInventoryItem(id);
        // Also remove from selection if present
        const newSet = new Set(selectedInventory);
        newSet.delete(id);
        setSelectedInventory(newSet);
        addToast("Item deleted", 'info');
    }
  };

  // Bulk Selection Logic
  const toggleInventorySelection = (id: string) => {
      const newSet = new Set(selectedInventory);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      setSelectedInventory(newSet);
  };

  const toggleSelectAll = () => {
      if (selectedInventory.size === inventory.length) {
          setSelectedInventory(new Set());
      } else {
          setSelectedInventory(new Set(inventory.map(i => i.id)));
      }
  };

  const handleBulkDelete = async () => {
      if (selectedInventory.size === 0) return;
      if (confirm(`Delete ${selectedInventory.size} items?`)) {
          const count = selectedInventory.size;
          await deleteInventoryBatch(Array.from(selectedInventory));
          setSelectedInventory(new Set());
          addToast(`${count} items deleted`, 'info');
      }
  };

  const handleBackup = () => {
      exportBackup(inventory, estimates);
      addToast("Backup file downloaded", 'success');
  };
  
  const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
        try {
            await importBackup(e.target.files[0]);
            addToast("Database Restored Successfully!", 'success');
        } catch(err) {
            addToast("Invalid backup file", 'error');
        }
    }
  };

  // --- Estimate Logic ---
  const addEstimateItem = (invItem?: InventoryItem) => {
    const newItem: EstimateItem = {
      id: crypto.randomUUID(),
      inventoryId: invItem?.id,
      productName: invItem ? invItem.productName : (searchTerm || ""),
      mrp: invItem ? invItem.mrp : 0,
      gstPercent: invItem ? invItem.gstPercent : 18,
      landingPrice: invItem ? invItem.landingPrice : 0,
      purchaseDiscountPercent: invItem ? invItem.purchaseDiscountPercent : 0,
      marginPercent: 20,
      quantity: 1,
      sellingBasic: invItem ? (invItem.landingPrice * 1.2) : 0,
    };
    
    setEstimateItems(prev => [...prev, newItem]);
    setSearchTerm('');
    setShowSuggestions(false);
    addToast("Item added to estimate", 'success');
  };

  const updateItem = (id: string, updates: Partial<EstimateItem>) => {
    setEstimateItems(prev => prev.map(item => {
      if (item.id !== id) return item;
      
      const newItem = { ...item, ...updates };
      if ('marginPercent' in updates) {
        newItem.sellingBasic = newItem.landingPrice * (1 + newItem.marginPercent / 100);
      } else if ('sellingBasic' in updates) {
         if (newItem.landingPrice > 0) {
            newItem.marginPercent = ((newItem.sellingBasic - newItem.landingPrice) / newItem.landingPrice) * 100;
         } else {
            newItem.marginPercent = 0;
         }
      } else if ('landingPrice' in updates) {
         newItem.sellingBasic = newItem.landingPrice * (1 + newItem.marginPercent / 100);
      }
      return newItem;
    }));
  };

  const calculateRow = (item: EstimateItem) => {
    const gstAmount = item.sellingBasic * (item.gstPercent / 100);
    const finalUnitPrice = item.sellingBasic + gstAmount;
    const totalFinalPrice = finalUnitPrice * item.quantity;
    
    const totalProfit = (item.sellingBasic - item.landingPrice) * item.quantity;
    return { gstAmount, finalUnitPrice, totalFinalPrice, totalProfit };
  };

  const subTotal = estimateItems.reduce((acc, item) => acc + calculateRow(item).totalFinalPrice, 0);
  const calculatedTotal = subTotal + (additionalCharges.packing || 0) + (additionalCharges.shipping || 0);
  const grandTotal = calculatedTotal + (additionalCharges.adjustment || 0);

  const handleGrandTotalChange = (newTotal: number) => {
     const diff = newTotal - calculatedTotal;
     setAdditionalCharges(prev => ({...prev, adjustment: diff}));
  };

  const generateInvoiceId = (cust: CustomerProfile): string => {
      const firmClean = (cust.firmName || cust.name).replace(/[^a-zA-Z]/g, '').toUpperCase();
      const nameClean = cust.name.replace(/[^a-zA-Z]/g, '').toUpperCase();
      const firmPrefix = firmClean.padEnd(3, 'X').substring(0, 3);
      const namePrefix = nameClean.padEnd(3, 'X').substring(0, 3);
      const prefix = `${firmPrefix}${namePrefix}`;
      const existingCount = estimates.filter(e => e.invoiceNumber?.startsWith(prefix)).length;
      return `${prefix}${existingCount + 1}`;
  };

  // --- STOCK DEDUCTION LOGIC ---
  const handleSaveEstimate = async (status: EstimateStatus) => {
      if (!customerDetails.name) {
          addToast("Please enter customer name", 'error');
          return;
      }
      if (estimateItems.length === 0) {
          addToast("Please add items to estimate", 'error');
          return;
      }

      let invNum = estimates.find(e => e.id === currentEstimateId)?.invoiceNumber;
      if (status === 'confirmed' && !invNum) {
          invNum = generateInvoiceId(customerDetails);
      }

      const newRecord: EstimateRecord = {
          id: currentEstimateId || crypto.randomUUID(),
          date: new Date().toISOString(),
          lastModified: Date.now(),
          status,
          paymentStatus: 'unpaid', // Default for new
          invoiceNumber: invNum,
          customer: customerDetails,
          items: estimateItems,
          additionalCharges
      };

      // Handle Stock Updates
      const oldRecord = estimates.find(e => e.id === newRecord.id);
      const adjustments: {id: string, qtyChange: number}[] = [];
      const stockMap = new Map<string, number>();

      // If old was confirmed, add back its quantity
      if (oldRecord && oldRecord.status === 'confirmed') {
          oldRecord.items.forEach(item => {
              if (item.inventoryId) {
                  stockMap.set(item.inventoryId, (stockMap.get(item.inventoryId) || 0) + item.quantity);
              }
          });
      }

      // If new is confirmed, subtract its quantity
      if (newRecord.status === 'confirmed') {
          newRecord.items.forEach(item => {
              if (item.inventoryId) {
                  stockMap.set(item.inventoryId, (stockMap.get(item.inventoryId) || 0) - item.quantity);
              }
          });
      }
      
      stockMap.forEach((qty, id) => {
          if (qty !== 0) adjustments.push({ id, qtyChange: qty });
      });

      if (adjustments.length > 0) {
          await updateInventoryStock(adjustments);
      }

      await saveEstimateRecord(newRecord);
      setCurrentEstimateId(newRecord.id);

      if (status === 'confirmed') {
         addToast(`Order Confirmed! Stock Updated. Invoice: ${invNum}`, 'success');
      } else {
         addToast("Draft Saved Successfully", 'success');
      }
  };

  const handleDeleteEstimate = async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if(confirm("Permanently delete this estimate/order? Stock will be restored if confirmed.")) {
          // Restore stock if confirmed
          const rec = estimates.find(r => r.id === id);
          if (rec && rec.status === 'confirmed') {
              const adjustments = rec.items
                 .filter(i => i.inventoryId)
                 .map(i => ({ id: i.inventoryId!, qtyChange: i.quantity }));
              if(adjustments.length > 0) await updateInventoryStock(adjustments);
          }

          await deleteEstimateRecord(id);
          if(currentEstimateId === id) createNewEstimate();
          addToast("Estimate Deleted", 'info');
      }
  };

  const handleGeneratePDF = (action: 'print' | 'download') => {
      const currentEst = estimates.find(e => e.id === currentEstimateId);
      generateEstimatePDF(
          customerDetails, 
          estimateItems, 
          businessProfile,
          additionalCharges,
          !currentEst || currentEst.status === 'draft',
          currentEst?.invoiceNumber,
          action
      );
      addToast(action === 'print' ? "Generating Preview..." : "Downloading PDF...", 'info');
  };

  const loadEstimateToEditor = (record: EstimateRecord) => {
      setCustomerDetails(record.customer);
      setEstimateItems(record.items);
      setAdditionalCharges(record.additionalCharges || { packing: 0, shipping: 0, adjustment: 0 });
      setCurrentEstimateId(record.id);
      setActiveTab('estimate');
      setShowCustomerExtras(!!(record.customer.gstin || record.customer.address));
      addToast("Estimate Loaded", 'success');
  };

  const createNewEstimate = () => {
      if (estimateItems.length > 0 && !confirm("Discard current estimate?")) return;
      setCustomerDetails({ name: '', firmName: '', phone: '', address: '', gstin: '' });
      setEstimateItems([]);
      setAdditionalCharges({ packing: 0, shipping: 0, adjustment: 0 });
      setCurrentEstimateId(null);
      setActiveTab('estimate');
      addToast("New Estimate Started", 'info');
  };

  const handlePaymentUpdate = async (e: React.ChangeEvent<HTMLSelectElement>, estId: string) => {
      const newStatus = e.target.value as PaymentStatus;
      await updateEstimatePaymentStatus(estId, newStatus);
      addToast(`Payment marked as ${newStatus}`, 'success');
  };

  const openWhatsApp = (est: EstimateRecord, total: number) => {
      if (!est.customer.phone) {
          addToast("Customer has no phone number", 'error');
          return;
      }
      
      const dateStr = new Date(est.date).toLocaleDateString();
      const statusText = est.paymentStatus === 'paid' ? 'PAID' : 'PENDING';
      
      const msg = `Hello ${est.customer.name}, here are the details for your Invoice #${est.invoiceNumber} dated ${dateStr}.\n\nTotal Amount: ₹${total.toFixed(0)}\nStatus: ${statusText}\n\nThank you for your business!\n${businessProfile.name}`;
      
      const url = `https://wa.me/91${est.customer.phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(msg)}`;
      window.open(url, '_blank');
  };

  // --- Clients Logic ---
  const getUniqueKey = (c: CustomerProfile) => `${c.name}||${c.firmName}`;
  const uniqueClientKeys = Array.from(new Set(estimates.map(e => getUniqueKey(e.customer)))).sort();
  
  const clientSuggestions = customerDetails.name ? estimates.filter(e => {
      const fullString = `${e.customer.name} ${e.customer.firmName} ${e.customer.phone}`.toLowerCase();
      return fullString.includes(customerDetails.name.toLowerCase());
  }).reduce((unique, e) => {
      const key = getUniqueKey(e.customer);
      if (!unique.some(u => getUniqueKey(u.customer) === key)) {
          unique.push(e);
      }
      return unique;
  }, [] as EstimateRecord[]) : [];

  const filteredClientHistory = uniqueClientKeys.filter(key => {
      const [name, firm] = key.split('||');
      const search = clientHistorySearch.toLowerCase();
      const matchesText = name.toLowerCase().includes(search) || (firm || '').toLowerCase().includes(search);
      let matchesDate = true;
      if (clientFilterDate) {
           const clientDocs = estimates.filter(e => getUniqueKey(e.customer) === key);
           matchesDate = clientDocs.some(e => e.date.startsWith(clientFilterDate));
      }
      return matchesText && matchesDate;
  });

  const sortEstimates = (list: EstimateRecord[]) => {
      return list.sort((a, b) => {
          const totalA = a.items.reduce((s, i) => s + (i.sellingBasic * (1+i.gstPercent/100)*i.quantity),0) + (a.additionalCharges?.adjustment || 0);
          const totalB = b.items.reduce((s, i) => s + (i.sellingBasic * (1+i.gstPercent/100)*i.quantity),0) + (b.additionalCharges?.adjustment || 0);
          switch(clientSort) {
              case 'date_asc': return new Date(a.date).getTime() - new Date(b.date).getTime();
              case 'date_desc': return new Date(b.date).getTime() - new Date(a.date).getTime();
              case 'amt_asc': return totalA - totalB;
              case 'amt_desc': return totalB - totalA;
              default: return 0;
          }
      });
  };

  const suggestions = searchTerm ? inventory.filter(i => {
      const term = searchTerm.toLowerCase();
      return i.productName.toLowerCase().includes(term) || i.note?.toLowerCase().includes(term);
  }) : [];

  const totalProfit = estimateItems.reduce((acc, item) => acc + calculateRow(item).totalProfit, 0) + additionalCharges.adjustment;
  const totalSavings = estimateItems.reduce((acc, item) => {
     if(item.mrp > 0 && item.sellingBasic < item.mrp) {
        return acc + ((item.mrp - item.sellingBasic) * item.quantity);
     }
     return acc;
  }, 0);

  const getSyncIcon = () => {
      switch(syncStatus) {
          case 'synced': return <Wifi className="w-4 h-4 text-emerald-500" />;
          case 'syncing': return <RefreshCw className="w-4 h-4 text-blue-500 animate-spin" />;
          case 'error': return <AlertCircle className="w-4 h-4 text-red-500" />;
          default: return <WifiOff className="w-4 h-4 text-slate-300" />;
      }
  };
  
  const getSyncTitle = () => {
       switch(syncStatus) {
          case 'synced': return 'Synced with Cloudflare';
          case 'syncing': return 'Syncing...';
          case 'error': return `Error: ${syncMessage}`; 
          default: return 'Local Mode (Configure Cloudflare in Settings)';
      }
  };

  const handleSyncClick = () => {
      if (syncStatus === 'error') {
          alert(`SYNC ERROR:\n\n${syncMessage}\n\nTroubleshooting:\n1. Check your internet connection.\n2. Ensure the Worker URL is correct in Settings.\n3. Ensure you added the KV Namespace binding named 'STORE' in Cloudflare.`);
      }
      syncData();
      addToast("Sync triggered", 'info');
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 pb-64">
      {/* Toast Container */}
      <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-[60] flex flex-col gap-2 items-center pointer-events-none w-full max-w-sm px-4">
          {toasts.map(t => (
              <div 
                key={t.id} 
                className={`pointer-events-auto px-4 py-3 rounded-xl shadow-2xl text-sm font-medium text-white animate-fade-in-up flex items-center gap-3 w-auto min-w-[200px] justify-center backdrop-blur-md ${
                    t.type === 'error' ? 'bg-red-600/95' : 
                    t.type === 'info' ? 'bg-slate-700/95' : 
                    'bg-emerald-600/95'
                }`}
              >
                  {t.type === 'success' && <CheckCircle className="w-4 h-4 shrink-0" />}
                  {t.type === 'error' && <AlertCircle className="w-4 h-4 shrink-0" />}
                  {t.type === 'info' && <Info className="w-4 h-4 shrink-0" />}
                  {t.message}
              </div>
          ))}
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col">
             <div className="bg-slate-100 px-6 py-4 border-b border-slate-200 flex justify-between items-center shrink-0">
               <h2 className="font-bold text-lg flex items-center gap-2">
                 <Settings className="w-5 h-5 text-slate-500" /> Settings
               </h2>
               <button onClick={() => setShowSettings(false)} className="text-slate-500 hover:text-red-500 transition">
                 <X className="w-5 h-5" />
               </button>
             </div>
             <div className="p-6 space-y-8 overflow-y-auto grow">
               {/* Cloudflare Sync Settings */}
               <div className="bg-blue-50 border border-blue-100 rounded-xl p-5">
                   <div className="flex items-start justify-between mb-4">
                       <div>
                           <h3 className="font-bold text-blue-900 flex items-center gap-2"><Server className="w-4 h-4" /> Cloudflare Sync Setup</h3>
                           <p className="text-xs text-blue-700 mt-1">Sync requires a <strong>separate</strong> Worker with a KV Binding.</p>
                       </div>
                       <button onClick={copyWorkerCode} className="text-xs bg-white border border-blue-200 text-blue-700 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition flex items-center gap-1 font-medium">
                           <Copy className="w-3 h-3" /> Copy Worker Code
                       </button>
                   </div>
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                       <div className="md:col-span-2">
                           <label className="block text-xs font-bold uppercase text-blue-800 mb-1">Worker URL</label>
                           <div className="flex items-center gap-2">
                               <Globe className="w-4 h-4 text-blue-400" />
                               <input 
                                  type="text" 
                                  className="w-full border border-blue-200 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/20 outline-none"
                                  placeholder="https://jirawala-sync.yourname.workers.dev"
                                  value={cloudUrl}
                                  onChange={e => setCloudUrl(e.target.value)}
                               />
                           </div>
                       </div>
                       <div className="md:col-span-2">
                           <label className="block text-xs font-bold uppercase text-blue-800 mb-1">Secret Token</label>
                           <div className="flex items-center gap-2">
                               <Key className="w-4 h-4 text-blue-400" />
                               <input 
                                  type="password" 
                                  className="w-full border border-blue-200 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/20 outline-none"
                                  placeholder="Enter a secret key"
                                  value={cloudToken}
                                  onChange={e => setCloudToken(e.target.value)}
                               />
                           </div>
                       </div>
                   </div>
               </div>
               {/* Business Profile */}
               <div className="space-y-4">
                   <h3 className="font-bold text-slate-700 border-b border-slate-200 pb-2">Business Profile</h3>
                   <div className="flex items-center gap-4">
                      <div className="w-20 h-20 bg-slate-100 rounded-lg border border-dashed border-slate-300 flex items-center justify-center overflow-hidden relative group cursor-pointer shrink-0">
                        {businessProfile.logoUrl ? (
                           <img src={businessProfile.logoUrl} alt="Logo" className="w-full h-full object-contain" />
                        ) : (
                           <ImageIcon className="w-8 h-8 text-slate-400" />
                        )}
                        <input type="file" accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleLogoUpload} />
                      </div>
                      <div className="flex-1">
                         <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">Business Name</label>
                         <input 
                            type="text" 
                            className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                            placeholder="Jirawala Axis"
                            value={businessProfile.name}
                            onChange={e => setBusinessProfile(p => ({...p, name: e.target.value}))}
                         />
                      </div>
                   </div>
                   <div>
                      <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">Address</label>
                      <textarea 
                        className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                        rows={2}
                        value={businessProfile.address}
                        onChange={e => setBusinessProfile(p => ({...p, address: e.target.value}))}
                      />
                   </div>
                   <div className="grid grid-cols-2 gap-4">
                     <div>
                        <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">GSTIN</label>
                        <input 
                            type="text" 
                            className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                            value={businessProfile.gstin}
                            onChange={e => setBusinessProfile(p => ({...p, gstin: e.target.value}))}
                        />
                     </div>
                     <div>
                        <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">Phone</label>
                        <input 
                            type="text" 
                            className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                            value={businessProfile.phone}
                            onChange={e => setBusinessProfile(p => ({...p, phone: e.target.value}))}
                        />
                     </div>
                   </div>
                   <div>
                        <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">Terms & Conditions</label>
                        <textarea 
                           className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                           rows={4}
                           placeholder="1. Goods once sold..."
                           value={businessProfile.terms}
                           onChange={e => setBusinessProfile(p => ({...p, terms: e.target.value}))}
                        />
                   </div>
               </div>
             </div>
             <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 text-right shrink-0">
               <button onClick={saveSettings} className="bg-primary text-white px-6 py-2 rounded-lg font-medium hover:bg-blue-700 transition shadow-sm">Save Settings</button>
             </div>
          </div>
        </div>
      )}

      {/* Inventory Modal */}
      {showManualAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in overflow-y-auto">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden my-8">
                <div className="bg-slate-100 px-6 py-4 border-b border-slate-200 flex justify-between items-center">
                    <h2 className="font-bold text-lg flex items-center gap-2">
                        {manualItem.id ? <Pencil className="w-5 h-5 text-primary" /> : <Plus className="w-5 h-5 text-primary" />} 
                        {manualItem.id ? "Edit Inventory Item" : "Add Manual Inventory"}
                    </h2>
                    <button onClick={() => setShowManualAdd(false)} className="text-slate-500 hover:text-red-500 transition">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2">
                        <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">Product Name</label>
                        <input type="text" className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 outline-none" value={manualItem.productName || ''} onChange={e => setManualItem(p => ({...p, productName: e.target.value}))} placeholder="e.g. 12mm Plywood" autoFocus />
                    </div>
                    <div className="sm:col-span-2">
                        <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">Notes / Keywords</label>
                        <input type="text" className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 outline-none" value={manualItem.note || ''} onChange={e => setManualItem(p => ({...p, note: e.target.value}))} placeholder="Search tags" />
                    </div>
                    <div>
                         <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">Vendor</label>
                         <input type="text" className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 outline-none" value={manualItem.vendor || ''} onChange={e => setManualItem(p => ({...p, vendor: e.target.value}))} />
                    </div>
                    <div>
                         <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">Date</label>
                         <input type="date" className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 outline-none" value={manualItem.date || ''} onChange={e => setManualItem(p => ({...p, date: e.target.value}))} />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">MRP</label>
                        <input type="number" className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 outline-none" value={valOrEmpty(manualItem.mrp || 0)} onChange={e => setManualItem(p => ({...p, mrp: parseFloat(e.target.value) || 0}))} placeholder="0.00" />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold uppercase text-amber-600 mb-1">Pur. Disc %</label>
                        <input type="number" className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500/20 outline-none text-amber-700" value={valOrEmpty(manualItem.purchaseDiscountPercent || 0)} onChange={e => setManualItem(p => ({...p, purchaseDiscountPercent: parseFloat(e.target.value) || 0}))} placeholder="0" />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold uppercase text-emerald-600 mb-1">Landing Cost</label>
                        <input type="number" className="w-full border border-emerald-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500/20 outline-none text-emerald-700 font-bold" value={valOrEmpty(manualItem.landingPrice || 0)} onChange={e => setManualItem(p => ({...p, landingPrice: parseFloat(e.target.value) || 0}))} placeholder="Net Cost" />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">GST %</label>
                        <input type="number" className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 outline-none" value={valOrEmpty(manualItem.gstPercent || 0)} onChange={e => setManualItem(p => ({...p, gstPercent: parseFloat(e.target.value) || 0}))} placeholder="18" />
                    </div>
                    <div className="sm:col-span-2">
                        <label className="block text-xs font-semibold uppercase text-blue-600 mb-1">Current Stock Quantity</label>
                        <input type="number" className="w-full border border-blue-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/20 outline-none text-blue-900 font-bold" value={valOrEmpty(manualItem.stock || 0)} onChange={e => setManualItem(p => ({...p, stock: parseFloat(e.target.value) || 0}))} placeholder="0" />
                    </div>
                </div>
                <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
                    <button onClick={() => setShowManualAdd(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg text-sm font-medium transition">Cancel</button>
                    <button onClick={handleManualInventorySave} className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition flex items-center gap-2">
                        <Save className="w-4 h-4" /> {manualItem.id ? 'Update Item' : 'Save Item'}
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="bg-white border-b border-slate-200 px-4 py-3 sticky top-0 z-30 flex items-center justify-between shadow-sm gap-2">
        <div className="flex items-center gap-2 shrink-0">
            <div className="bg-primary/10 p-2 rounded-lg">
                <Calculator className="w-6 h-6 text-primary" />
            </div>
            <h1 className="font-bold text-xl tracking-tight text-slate-800 hidden md:block">Jirawala Axis</h1>
        </div>
        <div className="flex items-center gap-2 md:gap-3 overflow-x-auto no-scrollbar">
            <div className="flex items-center bg-slate-100 p-1 rounded-lg">
                <button onClick={() => setActiveTab('dashboard')} className={`px-3 md:px-4 py-2 rounded-md text-sm font-medium transition-all whitespace-nowrap flex items-center gap-2 ${activeTab === 'dashboard' ? 'bg-white shadow text-primary' : 'text-slate-500 hover:text-slate-700'}`}>
                    <LayoutDashboard className="w-4 h-4" /> <span className="hidden sm:inline">Home</span>
                </button>
                <button onClick={() => setActiveTab('inventory')} className={`px-3 md:px-4 py-2 rounded-md text-sm font-medium transition-all whitespace-nowrap ${activeTab === 'inventory' ? 'bg-white shadow text-primary' : 'text-slate-500 hover:text-slate-700'}`}>Inventory</button>
                <button onClick={() => setActiveTab('estimate')} className={`px-3 md:px-4 py-2 rounded-md text-sm font-medium transition-all whitespace-nowrap ${activeTab === 'estimate' ? 'bg-white shadow text-primary' : 'text-slate-500 hover:text-slate-700'}`}>Estimate</button>
                <button onClick={() => setActiveTab('clients')} className={`px-3 md:px-4 py-2 rounded-md text-sm font-medium transition-all whitespace-nowrap ${activeTab === 'clients' ? 'bg-white shadow text-primary' : 'text-slate-500 hover:text-slate-700'}`}>Clients</button>
            </div>
            <div className="h-6 w-px bg-slate-200 mx-1"></div>
            <button onClick={handleSyncClick} className="flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-100 transition" title={getSyncTitle()}>
                 {getSyncIcon()}
                 {syncStatus === 'error' && <span className="text-[10px] text-red-500 font-bold hidden sm:block">Error</span>}
            </button>
            <button onClick={() => setShowSettings(true)} className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition shrink-0" title="Settings">
                <Settings className="w-5 h-5" />
            </button>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto p-3 md:p-4 mt-2 md:mt-4">
        
        {/* DASHBOARD TAB */}
        {activeTab === 'dashboard' && (
            <div className="space-y-6 animate-fade-in">
                {/* Top Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col">
                        <div className="text-slate-500 text-sm font-medium mb-1 flex items-center gap-2"><IndianRupee className="w-4 h-4" /> Total Sales (This Month)</div>
                        <div className="text-3xl font-bold text-slate-900">{numberToWordsSimple(dashboardStats.totalSales)}</div>
                        <div className="text-xs text-slate-400 mt-2">{dashboardStats.orderCount} orders processed</div>
                    </div>
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col">
                        <div className="text-emerald-600 text-sm font-medium mb-1 flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Net Profit (This Month)</div>
                        <div className="text-3xl font-bold text-emerald-700">{numberToWordsSimple(dashboardStats.totalProfit)}</div>
                        <div className="text-xs text-slate-400 mt-2">Based on Landing Cost vs Selling Price</div>
                    </div>
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col">
                        <div className="text-amber-600 text-sm font-medium mb-1 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Low Stock Items</div>
                        <div className="text-3xl font-bold text-amber-700">{dashboardStats.lowStockItems.length}</div>
                        <div className="text-xs text-slate-400 mt-2">Items with less than 10 qty</div>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Low Stock List */}
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
                            <h3 className="font-bold text-slate-800 flex items-center gap-2"><Package className="w-4 h-4 text-amber-500" /> Low Stock Alert</h3>
                        </div>
                        <div className="flex-1 overflow-y-auto max-h-[300px]">
                            {dashboardStats.lowStockItems.length === 0 ? (
                                <div className="p-8 text-center text-slate-400 italic">Stock levels look healthy!</div>
                            ) : (
                                <table className="w-full text-sm">
                                    <thead className="bg-slate-50 text-xs uppercase text-slate-500 sticky top-0">
                                        <tr>
                                            <th className="px-4 py-2 text-left">Item</th>
                                            <th className="px-4 py-2 text-right">Qty</th>
                                            <th className="px-4 py-2 text-right">Restock</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {dashboardStats.lowStockItems.map(item => (
                                            <tr key={item.id} className="hover:bg-slate-50">
                                                <td className="px-4 py-2 font-medium text-slate-700">{item.productName}</td>
                                                <td className="px-4 py-2 text-right font-bold text-red-600">{item.stock}</td>
                                                <td className="px-4 py-2 text-right">
                                                    <button onClick={() => openEditModal(item)} className="text-xs text-blue-600 hover:underline">Edit</button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>

                    {/* Top Selling */}
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
                            <h3 className="font-bold text-slate-800 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-emerald-500" /> Top Selling Items</h3>
                        </div>
                         <div className="flex-1 overflow-y-auto max-h-[300px]">
                            {dashboardStats.topItems.length === 0 ? (
                                <div className="p-8 text-center text-slate-400 italic">No sales data yet.</div>
                            ) : (
                                <table className="w-full text-sm">
                                    <thead className="bg-slate-50 text-xs uppercase text-slate-500 sticky top-0">
                                        <tr>
                                            <th className="px-4 py-2 text-left">Item</th>
                                            <th className="px-4 py-2 text-right">Qty Sold</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {dashboardStats.topItems.map((item, idx) => (
                                            <tr key={idx} className="hover:bg-slate-50">
                                                <td className="px-4 py-2 font-medium text-slate-700">{item.name}</td>
                                                <td className="px-4 py-2 text-right font-bold text-emerald-600">{item.qty}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        )}

        {activeTab === 'inventory' && (
            <div className="space-y-4 md:space-y-6 animate-fade-in">
                {/* Stats / Upload Area */}
                <div className="grid md:grid-cols-3 gap-4">
                    <div className="md:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 p-6 relative overflow-hidden">
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <h2 className="text-lg font-bold text-slate-800">Inventory Actions</h2>
                                <p className="text-slate-500 text-sm">Add via PDF or Manually</p>
                            </div>
                            <div className={`px-3 py-1 rounded-full text-xs font-medium ${isProcessing ? 'bg-amber-100 text-amber-700 animate-pulse' : 'bg-slate-100 text-slate-600'}`}>
                                {isProcessing ? 'Analyzing Invoice...' : 'Ready'}
                            </div>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-4">
                            <label className={`flex-1 flex flex-col items-center justify-center h-32 border-2 border-dashed border-slate-300 rounded-lg hover:border-primary hover:bg-slate-50 transition-all cursor-pointer group ${isProcessing ? 'opacity-50 pointer-events-none' : ''}`}>
                                <input type="file" className="hidden" accept="application/pdf" onChange={handleFileUpload} disabled={isProcessing} />
                                <Upload className="w-6 h-6 text-slate-400 group-hover:text-primary mb-2" />
                                <span className="text-sm text-slate-500 font-medium">Upload Invoice PDF</span>
                            </label>
                            <button onClick={openAddModal} className="flex-1 flex flex-col items-center justify-center h-32 border-2 border-dashed border-slate-300 rounded-lg hover:border-primary hover:bg-slate-50 transition-all cursor-pointer group">
                                <Plus className="w-6 h-6 text-slate-400 group-hover:text-primary mb-2" />
                                <span className="text-sm text-slate-500 font-medium">Add Item Manually</span>
                            </button>
                        </div>
                    </div>

                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col justify-between">
                         <div>
                             <h3 className="font-bold text-slate-800 mb-1">Database</h3>
                             <p className="text-slate-500 text-sm mb-4">{inventory.length} items stored</p>
                             {selectedInventory.size > 0 && (
                                 <div className="mb-3 p-2 bg-red-50 text-red-700 rounded-lg text-xs font-medium flex items-center justify-between">
                                     <span>{selectedInventory.size} selected</span>
                                     <button onClick={handleBulkDelete} className="bg-red-100 hover:bg-red-200 px-2 py-1 rounded">Delete</button>
                                 </div>
                             )}
                         </div>
                         <div className="grid grid-cols-2 gap-2">
                             <button onClick={handleBackup} className="flex items-center justify-center gap-1 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition">
                                <Download className="w-3 h-3" /> Backup
                             </button>
                             <label className="flex items-center justify-center gap-1 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition cursor-pointer">
                                <input type="file" className="hidden" accept=".json" onChange={handleRestore} />
                                <UploadCloud className="w-3 h-3" /> Restore
                             </label>
                         </div>
                    </div>
                </div>

                {/* Table */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500">
                                <tr>
                                    <th className="px-4 py-3 w-10">
                                        <button onClick={toggleSelectAll} className="text-slate-400 hover:text-slate-600">
                                            {selectedInventory.size > 0 && selectedInventory.size === inventory.length ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                                        </button>
                                    </th>
                                    <th className="px-4 py-3 min-w-[100px]">Date</th>
                                    <th className="px-4 py-3 min-w-[120px]">Vendor</th>
                                    <th className="px-4 py-3 min-w-[200px]">Product / Note</th>
                                    <th className="px-4 py-3 text-center min-w-[80px]">Stock</th>
                                    <th className="px-4 py-3 text-right min-w-[80px]">MRP</th>
                                    <th className="px-4 py-3 text-right text-amber-600 min-w-[80px]">Pur. Disc %</th>
                                    <th className="px-4 py-3 text-right min-w-[100px]">Landing Cost</th>
                                    <th className="px-4 py-3 text-right min-w-[60px]">GST %</th>
                                    <th className="px-4 py-3 text-center min-w-[80px]">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {inventory.map(item => (
                                    <tr key={item.id} className={`hover:bg-slate-50 cursor-pointer ${selectedInventory.has(item.id) ? 'bg-blue-50 hover:bg-blue-100' : ''}`} onClick={() => toggleInventorySelection(item.id)}>
                                        <td className="px-4 py-3">
                                            <div className={`w-4 h-4 border rounded flex items-center justify-center ${selectedInventory.has(item.id) ? 'bg-primary border-primary text-white' : 'border-slate-300'}`}>
                                                {selectedInventory.has(item.id) && <CheckCircle className="w-3 h-3" />}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{item.date}</td>
                                        <td className="px-4 py-3 text-slate-600">{item.vendor}</td>
                                        <td className="px-4 py-3">
                                            <div className="font-medium text-slate-900">{item.productName}</div>
                                            {item.note && <div className="text-xs text-slate-500 italic mt-0.5">{item.note}</div>}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <span className={`px-2 py-1 rounded-full text-xs font-bold ${item.stock < 10 ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'}`}>
                                                {item.stock || 0}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-right">₹{item.mrp}</td>
                                        <td className="px-4 py-3 text-right text-amber-700">{item.purchaseDiscountPercent > 0 ? item.purchaseDiscountPercent + '%' : '-'}</td>
                                        <td className="px-4 py-3 text-right text-emerald-600 font-medium">₹{item.landingPrice}</td>
                                        <td className="px-4 py-3 text-right">{item.gstPercent}%</td>
                                        <td className="px-4 py-3 text-center">
                                            <div className="flex items-center justify-center gap-2">
                                                <button onClick={(e) => { e.stopPropagation(); openEditModal(item); }} className="text-slate-400 hover:text-primary transition"><Pencil className="w-4 h-4" /></button>
                                                <button onClick={(e) => handleDeleteInventory(item.id, e)} className="text-slate-400 hover:text-red-500 transition"><Trash2 className="w-4 h-4" /></button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        )}

        {activeTab === 'clients' && (
            <div className="space-y-4 md:space-y-6 animate-fade-in">
                {/* Client Filters */}
                <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col md:flex-row gap-4 items-center justify-between">
                     <div className="relative w-full md:w-96">
                        <Search className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                        <input 
                            type="text"
                            placeholder="Search Client or Firm..."
                            className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                            value={clientHistorySearch}
                            onChange={e => setClientHistorySearch(e.target.value)}
                        />
                     </div>
                     <div className="flex items-center gap-3 w-full md:w-auto">
                        <div className="flex items-center gap-2 bg-slate-50 border border-slate-300 rounded-lg px-2 py-1">
                            <Calendar className="w-4 h-4 text-slate-500" />
                            <input 
                                type="date"
                                className="bg-transparent border-none text-sm focus:ring-0 text-slate-700 outline-none p-1"
                                value={clientFilterDate}
                                onChange={(e) => setClientFilterDate(e.target.value)}
                            />
                            {clientFilterDate && <button onClick={() => setClientFilterDate('')}><X className="w-3 h-3 text-slate-400 hover:text-red-500"/></button>}
                        </div>

                        <div className="flex items-center gap-2 flex-1">
                            <Filter className="w-4 h-4 text-slate-500" />
                            <select 
                                className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 outline-none w-full md:w-auto"
                                value={clientSort}
                                onChange={(e) => setClientSort(e.target.value as any)}
                            >
                                <option value="date_desc">Newest First</option>
                                <option value="date_asc">Oldest First</option>
                                <option value="amt_desc">High Amount</option>
                                <option value="amt_asc">Low Amount</option>
                            </select>
                        </div>
                     </div>
                </div>

                <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-slate-200">
                    <h2 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
                        <Users className="w-5 h-5 text-primary" /> Client Ledger
                    </h2>
                    
                    <div className="space-y-4">
                        {filteredClientHistory.length === 0 ? (
                            <div className="text-center py-10 text-slate-400 italic">No clients found matching your search.</div>
                        ) : (
                            filteredClientHistory.map(key => {
                                const [name, firm] = key.split('||');
                                const clientDocs = estimates.filter(e => getUniqueKey(e.customer) === key);
                                
                                // Apply Date Filtering Inside the Client Card
                                let relevantDocs = clientDocs;
                                if (clientFilterDate) {
                                    relevantDocs = clientDocs.filter(e => e.date.startsWith(clientFilterDate));
                                }
                                
                                const sortedDocs = sortEstimates(relevantDocs);
                                if(sortedDocs.length === 0) return null;

                                // --- Client Metrics Calculation ---
                                const clientTotalBusiness = clientDocs.reduce((acc, doc) => {
                                    if (doc.status === 'confirmed') {
                                        return acc + doc.items.reduce((s, i) => s + (i.sellingBasic * (1 + i.gstPercent/100) * i.quantity), 0) + doc.additionalCharges.adjustment + doc.additionalCharges.packing + doc.additionalCharges.shipping;
                                    }
                                    return acc;
                                }, 0);

                                const clientTotalDue = clientDocs.reduce((acc, doc) => {
                                    if (doc.status === 'confirmed' && doc.paymentStatus !== 'paid') {
                                         // Assuming full amount is due if not paid. 
                                         // Future improvement: Subtract partial amounts if added to 'amountPaid'
                                         const total = doc.items.reduce((s, i) => s + (i.sellingBasic * (1 + i.gstPercent/100) * i.quantity), 0) + doc.additionalCharges.adjustment + doc.additionalCharges.packing + doc.additionalCharges.shipping;
                                         return acc + total;
                                    }
                                    return acc;
                                }, 0);

                                return (
                                    <div key={key} className="border border-slate-200 rounded-lg overflow-hidden">
                                        {/* Client Header */}
                                        <div className="bg-slate-50 px-4 py-3 font-medium text-slate-800 flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className="font-bold text-lg">{name}</span>
                                                    {firm && <span className="text-xs text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full uppercase tracking-wider">{firm}</span>}
                                                </div>
                                                <div className="text-xs text-slate-500 flex items-center gap-2 mt-1">
                                                    {clientDocs[0].customer.phone && (
                                                        <span className="flex items-center gap-1"><Smartphone className="w-3 h-3"/> {clientDocs[0].customer.phone}</span>
                                                    )}
                                                </div>
                                            </div>
                                            
                                            <div className="flex items-center gap-4 w-full md:w-auto bg-white border border-slate-200 rounded-lg px-3 py-1.5 shadow-sm">
                                                <div className="text-right">
                                                    <div className="text-[10px] text-slate-400 uppercase font-bold">Total Business</div>
                                                    <div className="text-sm font-bold text-slate-700">₹{numberToWordsSimple(clientTotalBusiness)}</div>
                                                </div>
                                                <div className="h-8 w-px bg-slate-100"></div>
                                                <div className="text-right">
                                                    <div className="text-[10px] text-slate-400 uppercase font-bold">Total Due</div>
                                                    <div className={`text-sm font-bold ${clientTotalDue > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                                                        ₹{numberToWordsSimple(clientTotalDue)}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        
                                        {/* Doc List */}
                                        <div className="divide-y divide-slate-100">
                                            {sortedDocs.map(doc => {
                                                const docTotal = doc.items.reduce((s, i) => s + (i.sellingBasic * (1 + i.gstPercent/100) * i.quantity), 0) + doc.additionalCharges.adjustment + doc.additionalCharges.packing + doc.additionalCharges.shipping;
                                                const dateObj = new Date(doc.lastModified || doc.date);
                                                
                                                return (
                                                    <div key={doc.id} className="px-4 py-3 flex flex-col sm:flex-row justify-between items-center gap-3 hover:bg-slate-50 transition group">
                                                        <div className="w-full sm:w-auto">
                                                            <div className="text-sm font-medium flex items-center gap-2">
                                                                <span className={`w-2 h-2 rounded-full shrink-0 ${doc.status === 'confirmed' ? 'bg-emerald-500' : 'bg-amber-400'}`}></span>
                                                                {doc.status === 'confirmed' ? (
                                                                    <span className="text-slate-900">Inv <span className="font-mono">#{doc.invoiceNumber}</span></span>
                                                                ) : (
                                                                    <span className="text-slate-500 italic">Draft</span>
                                                                )}
                                                                
                                                            </div>
                                                            <div className="text-xs text-slate-500 flex flex-wrap gap-2 mt-1">
                                                                <span>{dateObj.toLocaleDateString()}</span>
                                                                <span className="hidden sm:inline">•</span>
                                                                <span>{doc.items.length} Items</span>
                                                                <span className="hidden sm:inline">•</span>
                                                                <span className="font-semibold text-slate-700">₹{docTotal.toFixed(0)}</span>
                                                            </div>
                                                        </div>
                                                        
                                                        {/* Actions */}
                                                        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                                                            {/* Payment Status Dropdown */}
                                                            {doc.status === 'confirmed' && (
                                                                <div className="relative">
                                                                    <select 
                                                                        value={doc.paymentStatus || 'unpaid'} 
                                                                        onChange={(e) => handlePaymentUpdate(e, doc.id)}
                                                                        className={`text-xs font-bold py-1 pl-2 pr-6 rounded border appearance-none cursor-pointer outline-none transition ${
                                                                            doc.paymentStatus === 'paid' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                                                            doc.paymentStatus === 'partial' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                                                            'bg-red-50 text-red-700 border-red-200'
                                                                        }`}
                                                                    >
                                                                        <option value="unpaid">Unpaid</option>
                                                                        <option value="partial">Partial</option>
                                                                        <option value="paid">Paid</option>
                                                                    </select>
                                                                    <Wallet className="w-3 h-3 absolute right-2 top-1.5 opacity-50 pointer-events-none" />
                                                                </div>
                                                            )}

                                                            {/* WhatsApp Button */}
                                                            {doc.customer.phone && (
                                                                <button 
                                                                    onClick={() => openWhatsApp(doc, docTotal)}
                                                                    className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-md transition border border-transparent hover:border-emerald-200"
                                                                    title="Share on WhatsApp"
                                                                >
                                                                    <MessageCircle className="w-4 h-4" />
                                                                </button>
                                                            )}
                                                            
                                                            <div className="h-4 w-px bg-slate-200 mx-1"></div>

                                                            <button 
                                                                onClick={() => loadEstimateToEditor(doc)}
                                                                className="text-xs bg-white border border-slate-200 hover:border-primary hover:text-primary px-3 py-1.5 rounded-md transition"
                                                            >
                                                                View
                                                            </button>
                                                            <button 
                                                                onClick={(e) => handleDeleteEstimate(doc.id, e)}
                                                                className="p-1.5 text-slate-400 hover:text-red-500 transition rounded-md hover:bg-red-50"
                                                                title="Delete Estimate"
                                                            >
                                                                <Trash2 className="w-4 h-4" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>
        )}

        {activeTab === 'estimate' && (
            <div className="space-y-4 md:space-y-6 animate-fade-in">
                {/* Estimate Controls */}
                <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 relative z-20">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 border-b border-slate-100 pb-4 gap-3">
                        <div className="flex items-center gap-2">
                           {currentEstimateId ? (
                               <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-1 rounded">EDITING {estimates.find(e => e.id === currentEstimateId)?.status === 'confirmed' ? 'ORDER' : 'DRAFT'}</span>
                           ) : (
                               <span className="bg-slate-100 text-slate-600 text-xs font-bold px-2 py-1 rounded">NEW ESTIMATE</span>
                           )}
                           <button onClick={createNewEstimate} className="text-xs text-primary hover:text-blue-800 ml-2 flex items-center gap-1"><RotateCcw className="w-3 h-3"/> Reset</button>
                        </div>
                        <div className="flex gap-2 w-full sm:w-auto">
                           <button 
                                onClick={() => handleSaveEstimate('draft')}
                                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 py-2 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-lg text-sm font-medium transition"
                           >
                               <FileClock className="w-4 h-4" /> <span className="hidden sm:inline">Save</span> Draft
                           </button>
                           <button 
                                onClick={() => handleSaveEstimate('confirmed')}
                                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 py-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg text-sm font-medium transition"
                           >
                               <CheckCircle className="w-4 h-4" /> Confirm <span className="hidden sm:inline">Order</span>
                           </button>
                        </div>
                    </div>

                    <div className="flex flex-col lg:flex-row gap-6 justify-between mb-4">
                        {/* Customer Details Section */}
                        <div className="flex-1 bg-slate-50 rounded-lg p-3 border border-slate-200 relative" ref={clientSearchRef}>
                             <div className="flex justify-between items-center mb-2">
                                 <div className="text-xs font-bold text-slate-500 uppercase tracking-wide">Client Details</div>
                                 <button 
                                    onClick={() => setShowCustomerExtras(!showCustomerExtras)}
                                    className="text-xs text-primary hover:text-blue-700 flex items-center gap-1"
                                 >
                                     {showCustomerExtras ? 'Hide Details' : 'Add Details'}
                                     {showCustomerExtras ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                 </button>
                             </div>
                             
                             <div className="grid grid-cols-1 gap-3 relative">
                                 <input 
                                    type="text" 
                                    placeholder="Customer Name"
                                    className="px-3 py-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-primary/20 outline-none w-full bg-white"
                                    value={customerDetails.name}
                                    onChange={e => {
                                        setCustomerDetails(p => ({...p, name: e.target.value}));
                                        setShowClientSuggestions(true);
                                    }}
                                    onFocus={() => setShowClientSuggestions(true)}
                                 />
                                 {/* Client Autocomplete */}
                                 {showClientSuggestions && clientSuggestions.length > 0 && (
                                     <div className="absolute top-10 left-0 right-0 z-50 bg-white border border-slate-200 rounded-md shadow-lg max-h-40 overflow-y-auto">
                                         {clientSuggestions.map(rec => (
                                             <div 
                                                key={rec.id} 
                                                className="px-3 py-2 hover:bg-slate-50 cursor-pointer text-sm text-slate-700 flex flex-col border-b border-slate-50 last:border-0"
                                                onClick={() => {
                                                    setCustomerDetails(rec.customer);
                                                    setShowCustomerExtras(!!(rec.customer.address || rec.customer.gstin || rec.customer.firmName));
                                                    setShowClientSuggestions(false);
                                                }}
                                             >
                                                 <span className="font-medium">{rec.customer.name}</span>
                                                 <span className="text-xs text-slate-400">{rec.customer.firmName} • {rec.customer.phone}</span>
                                             </div>
                                         ))}
                                     </div>
                                 )}
                                 
                                 {showCustomerExtras && (
                                     <div className="grid grid-cols-1 md:grid-cols-2 gap-3 animate-fade-in">
                                         <input 
                                            type="text" 
                                            placeholder="Firm Name"
                                            className="px-3 py-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-primary/20 outline-none w-full bg-white"
                                            value={customerDetails.firmName}
                                            onChange={e => setCustomerDetails(p => ({...p, firmName: e.target.value}))}
                                         />
                                         <input 
                                            type="text" 
                                            placeholder="Phone Number"
                                            className="px-3 py-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-primary/20 outline-none w-full bg-white"
                                            value={customerDetails.phone}
                                            onChange={e => setCustomerDetails(p => ({...p, phone: e.target.value}))}
                                         />
                                         <input 
                                            type="text" 
                                            placeholder="GSTIN (Optional)"
                                            className="px-3 py-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-primary/20 outline-none w-full bg-white md:col-span-2"
                                            value={customerDetails.gstin}
                                            onChange={e => setCustomerDetails(p => ({...p, gstin: e.target.value}))}
                                         />
                                         <div className="md:col-span-2">
                                             <textarea 
                                                placeholder="Billing Address"
                                                rows={2}
                                                className="px-3 py-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-primary/20 outline-none w-full bg-white resize-none"
                                                value={customerDetails.address}
                                                onChange={e => setCustomerDetails(p => ({...p, address: e.target.value}))}
                                             />
                                         </div>
                                     </div>
                                 )}
                             </div>
                        </div>

                        {/* Actions */}
                        <div className="flex flex-row lg:flex-col gap-3 justify-between lg:justify-start">
                            <div className="flex items-center bg-slate-100 rounded-lg p-1 border border-slate-200 w-fit">
                                <button 
                                    onClick={() => setViewMode('editor')}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium transition ${viewMode === 'editor' ? 'bg-white shadow text-primary' : 'text-slate-500'}`}
                                >
                                    <Eye className="w-3 h-3" /> <span className="hidden sm:inline">Editor</span>
                                </button>
                                <button 
                                    onClick={() => setViewMode('client')}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium transition ${viewMode === 'client' ? 'bg-white shadow text-primary' : 'text-slate-500'}`}
                                >
                                    <EyeOff className="w-3 h-3" /> <span className="hidden sm:inline">Client</span>
                                </button>
                            </div>
                            
                            <div className="flex gap-2">
                                <button 
                                    onClick={() => handleGeneratePDF('print')}
                                    disabled={estimateItems.length === 0}
                                    className="flex-1 lg:flex-none flex items-center justify-center gap-2 bg-slate-900 text-white px-4 lg:px-6 py-2.5 rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition shadow-sm whitespace-nowrap font-medium text-sm"
                                    title="Preview & Print"
                                >
                                    <Share2 className="w-4 h-4" /> Print/Share
                                </button>
                                <button 
                                    onClick={() => handleGeneratePDF('download')}
                                    disabled={estimateItems.length === 0}
                                    className="flex items-center justify-center gap-2 bg-white border border-slate-200 text-slate-700 px-3 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition shadow-sm"
                                    title="Download PDF"
                                >
                                    <Download className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Smart Search and Add */}
                    <div className="flex flex-col md:flex-row gap-2 relative" ref={searchRef}>
                        <div className="flex-1 flex items-center border border-slate-300 rounded-lg bg-slate-50 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary transition-all overflow-hidden">
                            <Search className="w-5 h-5 text-slate-400 ml-3" />
                            <input 
                                type="text"
                                className="w-full px-3 py-3 bg-transparent outline-none"
                                placeholder="Type to search inventory..."
                                value={searchTerm}
                                onChange={e => {
                                    setSearchTerm(e.target.value);
                                    setShowSuggestions(true);
                                }}
                                onKeyDown={e => {
                                    if(e.key === 'Enter') addEstimateItem();
                                }}
                                onFocus={() => setShowSuggestions(true)}
                            />
                            <button 
                                onClick={() => addEstimateItem()}
                                className="px-4 py-2 bg-primary text-white font-medium hover:bg-blue-700 transition h-full whitespace-nowrap text-sm"
                            >
                                Add Item
                            </button>
                        </div>
                        
                        <button 
                            onClick={() => addEstimateItem()} 
                            className="px-4 py-2 bg-emerald-600 text-white font-medium rounded-lg hover:bg-emerald-700 transition whitespace-nowrap text-sm flex items-center justify-center gap-2"
                        >
                             <FilePlus className="w-4 h-4" /> Add Empty Row
                        </button>

                        {showSuggestions && suggestions.length > 0 && (
                            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-60 overflow-y-auto z-50 divide-y divide-slate-100 w-full md:w-[calc(100%-160px)]">
                                {suggestions.map(item => (
                                    <div 
                                        key={item.id} 
                                        onClick={() => addEstimateItem(item)}
                                        className="px-4 py-3 hover:bg-slate-50 cursor-pointer flex justify-between items-center group"
                                    >
                                        <div>
                                            <div className="font-medium text-slate-800">{item.productName}</div>
                                            <div className="text-xs text-slate-500 flex gap-2">
                                                <span>MRP: ₹{item.mrp}</span>
                                                <span className="text-emerald-600">Cost: ₹{item.landingPrice}</span>
                                                <span className={`font-bold ${item.stock < 10 ? 'text-red-500' : 'text-blue-500'}`}>Stock: {item.stock}</span>
                                                {item.note && <span className="text-slate-400 italic">- {item.note}</span>}
                                            </div>
                                        </div>
                                        <Plus className="w-4 h-4 text-slate-300 group-hover:text-primary" />
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Estimate Table */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500">
                                <tr>
                                    <th className="px-2 md:px-4 py-3 w-8">#</th>
                                    <th className="px-2 md:px-4 py-3 min-w-[180px]">Item Description</th>
                                    <th className="px-2 md:px-4 py-3 w-14 text-center min-w-[60px]">Qty</th>
                                    {viewMode === 'editor' && <th className="px-2 md:px-4 py-3 text-right w-24 bg-amber-50 text-amber-700 min-w-[80px]">Margin %</th>}
                                    <th className="px-2 md:px-4 py-3 text-right w-24 text-blue-600 min-w-[80px]">Disc</th>
                                    <th className="px-2 md:px-4 py-3 text-right w-28 min-w-[100px]">Basic Rate</th>
                                    <th className="px-2 md:px-4 py-3 text-right w-16 min-w-[60px]">GST %</th>
                                    <th className="px-2 md:px-4 py-3 text-right w-32 font-bold min-w-[100px]">Total</th>
                                    <th className="px-2 md:px-4 py-3 w-8"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {estimateItems.length === 0 ? (
                                    <tr><td colSpan={9} className="text-center py-12 text-slate-400 italic">Add items to start estimating</td></tr>
                                ) : (
                                    estimateItems.map((item, idx) => {
                                        const calc = calculateRow(item);
                                        // Calculate current discount for display
                                        const currentDisc = (item.mrp > 0 && item.sellingBasic < item.mrp) 
                                            ? ((item.mrp - item.sellingBasic) / item.mrp * 100)
                                            : 0;
                                        
                                        // Format for display - if 0 show empty string
                                        const displayedCustDisc = currentDisc === 0 ? '' : parseFloat(currentDisc.toFixed(2));

                                        return (
                                            <tr key={item.id} className="group hover:bg-slate-50 align-top">
                                                <td className="px-2 md:px-4 py-4 text-slate-400 text-xs md:text-sm">{idx + 1}</td>
                                                <td className="px-2 md:px-4 py-4">
                                                    <input 
                                                        type="text" 
                                                        value={item.productName}
                                                        onChange={(e) => updateItem(item.id, { productName: e.target.value })}
                                                        className="w-full bg-transparent border-none focus:ring-0 p-0 font-medium text-slate-800 placeholder-slate-400 text-sm md:text-base"
                                                        placeholder="Item Name"
                                                    />
                                                    {viewMode === 'editor' && (
                                                        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-[10px] text-slate-500 bg-slate-100/50 p-1.5 rounded border border-slate-100">
                                                            <div className="flex items-center gap-1">
                                                                <span className="uppercase tracking-wider font-semibold">MRP:</span>
                                                                <input 
                                                                  type="number" 
                                                                  value={valOrEmpty(item.mrp)} 
                                                                  onChange={(e) => updateItem(item.id, { mrp: parseFloat(e.target.value) || 0 })} 
                                                                  className="w-14 bg-transparent border-b border-slate-300 text-slate-700 p-0 focus:outline-none focus:border-primary h-4" 
                                                                />
                                                            </div>
                                                            <div className="w-px h-3 bg-slate-300 self-center"></div>
                                                            <div className="flex items-center gap-1">
                                                                <span className="uppercase tracking-wider font-semibold text-emerald-600">Landing:</span>
                                                                <input 
                                                                  type="number" 
                                                                  value={valOrEmpty(item.landingPrice)} 
                                                                  onChange={(e) => updateItem(item.id, { landingPrice: parseFloat(e.target.value) || 0 })} 
                                                                  className="w-14 bg-transparent border-b border-slate-300 text-emerald-700 p-0 focus:outline-none focus:border-primary h-4" 
                                                                />
                                                            </div>
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="px-2 md:px-4 py-4 text-center">
                                                    <input type="number" value={valOrEmpty(item.quantity)} onChange={(e) => updateItem(item.id, { quantity: parseFloat(e.target.value) || 0 })} className="w-10 md:w-12 text-center bg-slate-100 rounded border-none focus:ring-1 focus:ring-primary p-1 font-medium text-sm" />
                                                </td>
                                                {viewMode === 'editor' && (
                                                    <td className="px-2 md:px-4 py-4 text-right bg-amber-50 align-middle">
                                                        <div className="flex items-center justify-end gap-1">
                                                            <input type="number" step="any" value={valOrEmpty(item.marginPercent)} onChange={(e) => {const val = e.target.value; updateItem(item.id, { marginPercent: val === '' ? 0 : parseFloat(val) });}} className="w-12 md:w-14 text-right bg-transparent border-b border-amber-300 focus:border-amber-600 focus:outline-none p-0 text-amber-800 font-medium text-sm" />
                                                            <span className="text-amber-600 text-xs">%</span>
                                                        </div>
                                                    </td>
                                                )}
                                                <td className="px-2 md:px-4 py-4 text-right align-middle">
                                                    <div className="flex items-center justify-end gap-1">
                                                        <input 
                                                            type="number" 
                                                            step="any" 
                                                            disabled={item.mrp <= 0} 
                                                            placeholder={item.mrp > 0 ? "" : "-"} 
                                                            value={displayedCustDisc}
                                                            onChange={(e) => {
                                                                const newDisc = parseFloat(e.target.value) || 0;
                                                                if (item.mrp > 0) {
                                                                    // Calculate new selling basic based on discount
                                                                    const newSelling = item.mrp * (1 - (newDisc / 100));
                                                                    updateItem(item.id, { sellingBasic: newSelling });
                                                                }
                                                            }}
                                                            className="w-12 md:w-14 text-right bg-transparent border-b border-slate-200 hover:border-blue-400 focus:border-blue-600 focus:outline-none text-blue-600 font-semibold p-0 disabled:opacity-50 disabled:cursor-not-allowed placeholder-slate-300 text-sm" 
                                                        />
                                                        <span className="text-blue-400 text-xs">%</span>
                                                    </div>
                                                </td>
                                                <td className="px-2 md:px-4 py-4 text-right align-middle">
                                                    <div className="flex items-center justify-end gap-1">
                                                        <span className="text-slate-400 text-xs">₹</span>
                                                        <input type="number" step="any" value={valOrEmpty(parseFloat(item.sellingBasic.toFixed(2)))} onChange={(e) => {const val = e.target.value; updateItem(item.id, { sellingBasic: val === '' ? 0 : parseFloat(val) })}} className="w-16 md:w-20 text-right bg-transparent border-b border-slate-200 focus:border-primary focus:outline-none font-semibold text-slate-900 p-0 text-sm" />
                                                    </div>
                                                </td>
                                                <td className="px-2 md:px-4 py-4 text-right align-middle">
                                                    <div className="flex items-center justify-end gap-1">
                                                        <input type="number" value={valOrEmpty(item.gstPercent)} onChange={(e) => updateItem(item.id, { gstPercent: parseFloat(e.target.value) || 0 })} className="w-8 text-right bg-transparent border-b border-dashed border-slate-300 focus:outline-none p-0 text-slate-500 text-sm" />
                                                        <span className="text-slate-400 text-xs">%</span>
                                                    </div>
                                                </td>
                                                <td className="px-2 md:px-4 py-4 text-right font-bold text-slate-900 align-middle text-base md:text-lg">₹{calc.totalFinalPrice.toFixed(0)}</td>
                                                <td className="px-2 md:px-4 py-4 text-center align-middle">
                                                    <button onClick={() => setEstimateItems(prev => prev.filter(i => i.id !== item.id))} className="opacity-100 md:opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition"><Trash2 className="w-4 h-4" /></button>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                    
                    {/* Footer Summary */}
                    {estimateItems.length > 0 && (
                        <div className="bg-slate-50 p-4 md:p-6 border-t border-slate-200">
                            <div className="flex flex-col md:flex-row justify-end items-start md:items-end gap-6 md:gap-8">
                                {viewMode === 'editor' && (
                                    <div className="text-right w-full md:w-auto flex justify-between md:block">
                                        <div className="text-sm text-slate-500 mb-1">My Profit</div>
                                        <div className="text-2xl font-bold text-emerald-600">+₹{totalProfit.toFixed(0)}</div>
                                    </div>
                                )}
                                <div className="text-right w-full md:w-auto flex justify-between md:block">
                                    <div className="text-sm text-slate-500 mb-1">Customer Saves</div>
                                    <div className="text-xl font-semibold text-blue-600">₹{totalSavings.toFixed(0)}</div>
                                </div>
                                <div className="text-right pl-0 md:pl-8 md:border-l border-slate-200 space-y-2 min-w-[200px] w-full md:w-auto pt-4 md:pt-0 border-t md:border-t-0">
                                    <div className="flex justify-between text-sm text-slate-500"><span>Items Total:</span><span>₹{subTotal.toFixed(0)}</span></div>
                                    <div className="flex justify-between items-center gap-4 text-sm text-slate-500"><span>Packing/Handling:</span><div className="flex items-center gap-1 w-20"><span>+₹</span><input type="number" className="w-full bg-white border border-slate-300 rounded px-1 py-0.5 text-right text-slate-800" value={valOrEmpty(additionalCharges.packing)} onChange={e => setAdditionalCharges(p => ({...p, packing: parseFloat(e.target.value) || 0}))} /></div></div>
                                    <div className="flex justify-between items-center gap-4 text-sm text-slate-500"><span>Freight/Shipping:</span><div className="flex items-center gap-1 w-20"><span>+₹</span><input type="number" className="w-full bg-white border border-slate-300 rounded px-1 py-0.5 text-right text-slate-800" value={valOrEmpty(additionalCharges.shipping)} onChange={e => setAdditionalCharges(p => ({...p, shipping: parseFloat(e.target.value) || 0}))} /></div></div>
                                    <div className="flex justify-between items-center gap-4 text-sm text-slate-500"><span>{additionalCharges.adjustment > 0 ? 'Surcharge/Adj:' : 'Round Off/Disc:'}</span><span className={`font-medium ${additionalCharges.adjustment > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{additionalCharges.adjustment > 0 ? '+' : ''}₹{additionalCharges.adjustment.toFixed(2)}</span></div>
                                    <div className="pt-2 border-t border-slate-300">
                                        <div className="text-sm text-slate-900 font-bold mb-1 flex items-center justify-between md:justify-end gap-2">Grand Total <Pencil className="w-3 h-3 text-slate-400" /></div>
                                        <div className="flex items-center justify-between md:justify-end gap-1"><span className="text-2xl font-bold text-slate-900">₹</span><input type="number" className="w-32 text-3xl font-bold text-slate-900 bg-transparent border-b-2 border-dashed border-slate-300 focus:border-primary focus:outline-none text-right" value={valOrEmpty(parseFloat(grandTotal.toFixed(0)))} onChange={e => handleGrandTotalChange(parseFloat(e.target.value) || 0)} /></div>
                                        <div className="text-xs text-slate-500 mt-1 italic text-right">{numberToWordsSimple(Math.round(grandTotal))}</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        )}
      </main>
    </div>
  );
}

export default App;
