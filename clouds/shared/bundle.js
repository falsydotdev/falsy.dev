// A minimal multi-file body shared by the Worker and the container: for each part, a uint32 name
// length, the UTF-8 name, a uint32 byte length, then the bytes. Parts stream without buffering.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function header(name, size) {
  const nameBytes = encoder.encode(name);
  const out = new Uint8Array(8 + nameBytes.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, nameBytes.length);
  out.set(nameBytes, 4);
  view.setUint32(4 + nameBytes.length, size);
  return out;
}

// parts: [{ name, size, body }], where body is bytes, a stream, or a function that opens one when
// the part is reached, so a Worker holds one upstream connection at a time.
export function writeBundle(parts) {
  const length = parts.reduce((sum, p) => sum + header(p.name, p.size).length + p.size, 0);
  let index = 0;
  let reader = null;
  const stream = new ReadableStream({
    async pull(controller) {
      while (true) {
        if (reader) {
          const { done, value } = await reader.read();
          if (!done) return controller.enqueue(value);
          reader = null;
        }
        if (index === parts.length) return controller.close();
        const part = parts[index++];
        controller.enqueue(header(part.name, part.size));
        const body = typeof part.body === 'function' ? await part.body() : part.body;
        if (body instanceof Uint8Array) controller.enqueue(body);
        else reader = body.getReader();
        return;
      }
    },
    cancel(reason) {
      return reader?.cancel(reason);
    },
  });
  return { stream, length };
}

export function readBundle(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts = [];
  let at = 0;
  while (at < bytes.length) {
    const nameLength = view.getUint32(at);
    const name = decoder.decode(bytes.subarray(at + 4, at + 4 + nameLength));
    const size = view.getUint32(at + 4 + nameLength);
    const start = at + 8 + nameLength;
    if (start + size > bytes.length) throw new Error(`Bundle part ${name} is truncated`);
    parts.push({ name, bytes: bytes.subarray(start, start + size) });
    at = start + size;
  }
  return parts;
}
