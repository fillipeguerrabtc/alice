// Declaração mínima para uso opcional de sharp em build/TS
// Evita falha de resolução quando sharp não está instalado no ambiente CI
declare module 'sharp' {
  const sharp: any;
  export = sharp;
}
