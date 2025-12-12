// Declaração mínima para uso opcional de sharp em build/TS.
// Objetivo: evitar falha de resolução quando sharp não está instalado no ambiente CI.
// REGRA 8: TypeScript strict, zero any.
declare module 'sharp' {
  type Input = Buffer | string | undefined;

  interface SharpInstance {
    resize: (width: number, height: number, options?: { fit?: string; withoutEnlargement?: boolean }) => SharpInstance;
    jpeg: (options?: { quality?: number }) => SharpInstance;
    toBuffer: () => Promise<Buffer>;
  }

  interface SharpModule {
    (input?: Input): SharpInstance;
    default?: (input?: Input) => SharpInstance;
  }

  const sharp: SharpModule;
  export = sharp;
}
