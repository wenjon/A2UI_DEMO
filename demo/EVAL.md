# 实测记录

环境：Windows、`flm serve qwen3.5:4b`、A2UI basic catalog v0.9、Vite dev server。

## 语义块模式（默认）

| 场景 | 结果 | 耗时 | 组件数 | 尝试 | warnings |
| --- | --- | ---: | ---: | ---: | ---: |
| 邮箱密码登录表单 | 通过 | 4.2s | 7 | 1 | 0 |
| 商品卡片（耳机，899 元） | 通过 | 6.8s | 8 | 1 | 0 |
| 会议预约表单 | 通过 | 5.4s | 8 | 1 | 0 |
| 个人资料编辑 | 通过 | 5.9s | 9 | 1 | 0 |
| 系统设置 | 通过 | 5.4s | 7 | 1 | 0 |
| 待办事项卡片 | 通过 | 6.9s | 9 | 1 | 0 |
| 电影卡片 | 通过 | 5.6s | 7 | 1 | 0 |

7/7 一次通过，均无自动修复 warning。登录表单实测 action 回调：

```json
{
  "name": "login",
  "surfaceId": "gen-...",
  "sourceComponentId": "b5",
  "context": {
    "email": "",
    "password": "",
    "remember": false
  }
}
```

说明表单数据绑定和按钮 action 已经接通。

## 直出 JSON 模式（实验）

用一个只有标题和一句话的简单卡片测试：

| 场景 | 结果 | 耗时 | tokens | 尝试 |
| --- | --- | ---: | ---: | ---: |
| 单标题简单卡片 | 通过 | 6.2s | 637 | 1 |

简单页面可以成功，但不能据此认为 4B 能稳定直出多组件 A2UI JSON。复杂表单在多次
尝试中仍会出现结构截断、单引号、属性缺失或引用错误，因此默认链路不使用该模式。

## 复测

在页面上逐个输入场景即可；也可以直接请求：

```powershell
$body = '{"prompt":"做一个邮箱和密码登录表单，带记住我和登录按钮","mode":"blocks"}'
$bytes = [Text.Encoding]::UTF8.GetBytes($body)
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:5173/api/generate `
  -ContentType 'application/json; charset=utf-8' -Body $bytes -TimeoutSec 240
```

重点看返回中的 `ok`、`attempts[].ok`、`warnings`、`components` 和 `messages`。
