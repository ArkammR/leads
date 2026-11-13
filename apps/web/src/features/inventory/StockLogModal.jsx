import { collection, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { useLive } from "../../hooks/useLive";
import { Empty, Modal } from "../../components/ui";
import MovesTable from "./MovesTable";

// Stock movement history for one product.
export default function StockLogModal({ product, onClose }) {
  const { data, loading, error } = useLive(
    () => query(collection(db, "stockMoves"), where("productId", "==", product.id), orderBy("createdAt", "desc"), limit(100)),
    [product.id]
  );
  const users = useLive(() => collection(db, "users"), []).data;
  return (
    <Modal title={`Stock log — ${product.name}`} onClose={onClose}>
      {error ? <Empty>Couldn't load the log ({error.code}).</Empty>
        : loading ? <Empty>Loading…</Empty>
        : data.length === 0 ? <Empty>No stock movements yet.</Empty>
        : <div className="tablewrap"><MovesTable rows={data} users={users} showProduct={false} /></div>}
    </Modal>
  );
}
