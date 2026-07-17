# Media Assets

负责人：数据存储、清洗与整合开发者。

职责：

- 视频、封面和抽帧资源的元数据。
- PostgreSQL Repository。
- 文件存储地址、MIME 类型和来源信息。
- 为 Video Stage、Data Pipeline 和 VLM Core 提供统一资源查询。

建议 PostgreSQL 保存元数据和 URL，原始大文件放对象存储或受管理的文件目录。
