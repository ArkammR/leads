import { useState } from "react";
import { collection, limit, orderBy, query } from "firebase/firestore";
import { Boxes, DollarSign, Lock, PackageX } from "lucide-react";
import { db } from "../../lib/firebase";
import { useLive } from "../../hooks/useLive";
import { Empty, PageHead, Stat } from "../../components/ui";
import { STOCK_REASONS as REASONS, available, money } from "../../lib/constants";
import MovesTable from "./MovesTable";

// Stock valuation and the latest stock movements across all products.
export default function Inventory() {
  const products = useLive(() => collection(db, "products"), []).data.filter((p) => p.isActive);
  const costs = Object.fromEntries(useLive(() => collection(db, "productCosts"), []).data.map((c) => [c.id, c.costPrice]));
  const users = useLive(() => collection(db, "users"), []).data;
  const moves = useLive(() => query(collection(db, "stockMoves"), orderBy("createdAt", "desc"), limit(300)), []);
  const [reason, setReason] = useState("");
  const [productId, setProductId] = useState("");

  const units = products.reduce((s, p) => s + (p.stock || 0), 0);
  const reserved = products.reduce((s, p) => s + (p.reserved || 0), 0);
  const atCost = products.reduce((s, p) => s + (p.stock || 0) * (costs[p.id] || 0), 0);
  const atRetail = products.reduce((s, p) => s + (p.stock || 0) * (p.price || 0), 0);
  const missingCost = products.filter((p) => costs[p.id] == null).length;
  const low = products.filter((p) => available(p) <= (p.minStockLevel || 0)).length;

  const rows = moves.data.filter((m) => (!reason || m.reason === reason) && (!productId || m.productId === productId));

  return (
    <>
      <PageHead title="Inventory" sub="Stock value and every stock movement, newest first" />
      <div className="grid stats">
        <Stat icon={Boxes} value={units} label="Units on hand" />
        <Stat icon={Lock} value={reserved} label="Reserved by pending orders" color="amber" />
        <Stat icon={DollarSign} value={money(atCost)} label={`Stock value at cost${missingCost ? ` (${missingCost} without cost)` : ""}`} color="green" />
        <Stat icon={DollarSign} value={money(atRetail)} label="Stock value at selling price" />
        <Stat icon={PackageX} value={low} label="Low-stock products" color="red" />
      </div>

      <div className="card">
        <div className="toolbar">
          <h2 style={{ flex: 1 }}>Stock movements</h2>
          <select className="select" style={{ width: "auto" }} value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">All products</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="select" style={{ width: "auto" }} value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">All types</option>
            {Object.entries(REASONS).map(([v, [l]]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        {moves.error ? <Empty>Couldn't load movements ({moves.error.code}).</Empty>
          : !moves.loading && rows.length === 0 ? <Empty>No stock movements yet. Use Stock in on the Products page to record deliveries.</Empty>
          : <div className="tablewrap"><MovesTable rows={rows} users={users} /></div>}
      </div>
    </>
  );
}
