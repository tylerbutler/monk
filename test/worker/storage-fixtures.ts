// Write deliberately malformed or older field shapes in the supported layout.
export async function putStoredItem(storage: DurableObjectStorage, collection: "checkpoint" | "award", value: unknown): Promise<void> {
  await storage.transaction(async tx => {
    const key = `record:v2:${collection}:000000000000`;
    const oldParts = await tx.get<number>(key);
    if (oldParts === undefined) throw new Error("Missing stored fixture item.");
    for (let i = 0; i < oldParts; i++) await tx.delete(`${key}:${String(i).padStart(6, "0")}`);
    const json = JSON.stringify(value);
    const parts = Math.ceil(json.length / 16000);
    await tx.put(key, parts);
    for (let i = 0; i < parts; i++) await tx.put(`${key}:${String(i).padStart(6, "0")}`, json.slice(i * 16000, (i + 1) * 16000));
  });
}
