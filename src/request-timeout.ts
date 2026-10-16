/** A deadline must reject even when an underlying native bridge ignores the
 * AbortSignal. The signal also cancels browser fetch/body reads when possible. */
export const withRequestTimeout = async <T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number, message: string): Promise<T> => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(message));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), deadline]);
  } catch (error) {
    if (controller.signal.aborted) throw new Error(message);
    throw error;
  } finally {
    clearTimeout(timer);
  }
};
