# Profile Pictures Directory

This directory stores user profile pictures.

## Default Image

- **File**: `default.jpg`
- **Size**: 128×128px recommended
- **Format**: JPG or WebP
- **Size Target**: 10-30 KB

Replace the placeholder `default.jpg` file with an actual default profile picture image.

## User Images

User profile pictures are stored as:
- **Filename**: `{userId}.webp`
- **Format**: WebP (optimized)
- **Size**: 128×128px (max)
- **Size Target**: 10-30 KB

Images are automatically optimized on upload using Sharp.

## Access

Profile pictures are served at `/pfp/{filename}` with 30-day caching.

