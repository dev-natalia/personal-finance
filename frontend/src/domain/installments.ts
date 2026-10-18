/**
 * Que parcela de uma compra a fatura `invoiceMonth` tem, sabendo que a 1ª caiu na fatura
 * `purchaseMonth` (meses como "AAAA-MM-01"). 0 ou menos: a compra ainda não tinha parcela ali.
 */
export function installmentIn(purchaseMonth: string, invoiceMonth: string): number {
  const [fromYear, fromMonth] = purchaseMonth.split('-').map(Number) as [number, number]
  const [toYear, toMonth] = invoiceMonth.split('-').map(Number) as [number, number]
  return (toYear - fromYear) * 12 + (toMonth - fromMonth) + 1
}
