export function readLimit(): number {
  return Number(process.env.ORDER_BATCH_LIMIT ?? '10');
}

export function placeOrder(qty: number): number {
  if (qty > readLimit()) {
    throw new Error("order exceeds the batch limit");
  }
  return qty;
}
