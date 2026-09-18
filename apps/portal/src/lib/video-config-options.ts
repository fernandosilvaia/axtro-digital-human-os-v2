/**
 * Opções de UI para configurar a persona de vídeo (D-V2-179).
 *
 * Vivem fora de `lib/actions/agent-video-config.ts` de propósito: aquele
 * arquivo é `"use server"`, e o compilador de produção do Next.js recusa
 * qualquer export que não seja função assíncrona nesse tipo de arquivo
 * ("A 'use server' file can only export async functions, found object").
 * `next build` pega isso; `tsc`/lint sozinhos não, por isso passou
 * despercebido até o build real (achado ao vivo, D-V2-181).
 */

export const CLOSER_VERTICALS = [
  { value: "metodo_silva", label: "Método Silva (genérico)" },
  { value: "life_insurance_qualification", label: "Life Insurance · qualificação" },
  { value: "life_insurance_recruitment", label: "Life Insurance · recrutamento" },
] as const;

export const VIDEO_LANGUAGES = [
  { value: "portuguese", label: "Português" },
  { value: "english", label: "Inglês" },
  { value: "spanish", label: "Espanhol" },
] as const;
