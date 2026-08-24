# Skill 目录与契约

每个 Skill 包含 Zod 参数模式、资源锁、优先级、超时和异步执行函数。LLM 只能从运行时目录选择 Skill。

| Skill | 主要参数 | 用途 |
|---|---|---|
| `say` | `message` | 游戏内回复 |
| `navigate_to` | `position`, `range` | 坐标寻路 |
| `follow_player` | `username`, `distance`, `durationSeconds` | 动态跟随 |
| `place_block` | `item`, `position` | 精确放置 |
| `place_nearby` | `item`, `radius` | 在附近寻找位置放置工作站 |
| `equip_item` | `item`, `destination` | 装备物品 |
| `drop_item` | `item`, `count` | 丢弃或交付物品 |
| `activate_block` | `position` | 使用按钮、门、床等 |
| `remember_location` | `key`, 可选 `position` | 命名并持久化位置 |
| `return_to_memory` | `key`, `range` | 返回记忆位置 |
| `collect_blocks` | `blocks`, `count`, `expectedItem`, `searchRadius` | 搜索、挖掘和收集 |
| `craft_item` | `item`, `count` | 精确合成 |
| `smelt_item` | `item`, `count` | 熔炉处理 |
| `fight_entity` | `entityId` 或 `name` | 对抗实体 |
| `escape_threat` | `distance` | 紧急撤离 |
| `eat_food` | `item` | 恢复饥饿 |
| `deliver_item` | `username`, `item`, `count` | 找到玩家并交付 |
| `store_items` | `position`, `items` | 存入箱子 |
| `retrieve_items` | `position`, `items` | 取出箱子物品 |
| `build_blueprint` | `blocks[]` | 按蓝图建造 |
| `explore_area` | `radius`, `waypoints` | 螺旋探索 |

资源锁包括 `movement`、`camera`、`main_hand`、`off_hand`、`inventory`、`container_ui` 和 `chat`。

优先级：

```text
background < normal < user < combat < emergency
```

高优先级 Skill 可以抢占持有相同资源的低优先级 Skill；反向抢占会被拒绝。所有执行器动作返回标准 `ExecutionResult`，Skill 再验证最终状态并返回 `SkillResult`。
