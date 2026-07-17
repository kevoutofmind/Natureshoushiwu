# Database Migrations

负责人：数据存储、清洗与整合开发者。

未来所有数据库结构变化按顺序写入该目录，例如：

```text
002_create_media_assets.sql
003_create_dance_videos.sql
004_create_action_segments.sql
```

迁移必须可重复审查，不要直接在共享数据库中手工修改表结构。

现有 `users` 初始化脚本暂时保留在 `bknd/db/001_create_users.sql`。
