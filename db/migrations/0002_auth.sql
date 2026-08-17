-- Add password_hash column to profiles for self-hosted credentials auth.
-- Migration: 0002_auth.sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS password_hash text;
