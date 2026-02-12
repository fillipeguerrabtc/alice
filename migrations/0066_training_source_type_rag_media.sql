-- Migration: 0066_training_source_type_rag_media
-- Descrição: Adiciona valor 'rag_media' ao enum training_source_type (Plano RAG Multimodal Fase 4)
-- Autor: Fillipe Guerra
-- Data: 11 de Fevereiro de 2026

ALTER TYPE training_source_type ADD VALUE IF NOT EXISTS 'rag_media';
