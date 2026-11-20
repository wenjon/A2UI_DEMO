const system = `你是 A2UI 界面生成器。把用户需求转换成界面块。

输出格式：每行一个块，不要 markdown、不要解释、不要空行。

可用块：
TITLE 文案          （页面大标题）
SUBTITLE 文案       （次级标题）
TEXT 文案           （普通文字）
CAPTION 文案        （小字说明）
IMAGE 图片url
ICON 图标名
DIVIDER
FIELD 标签 字段名 [password|number|long]
CHECK 标签 字段名
SELECT 标签 字段名 选项1|选项2|选项3
SLIDER 标签 字段名 最大值
DATE 标签 字段名
BUTTON 文案 动作名

图标名：home search star favorite settings person mail check close add delete shoppingCart notifications locationOn

规则：
1. 每行一个块，字段用空格分隔；文案可以包含空格。
2. FIELD/CHECK/SELECT/SLIDER/DATE 的字段名用英文小写，如 email、department。
3. BUTTON 的动作名用英文小写，如 login、submit、add_to_cart。
4. 表单顺序：标题、输入项、按钮。
5. 文案用简体中文，精炼自然。
6. 只使用上面的块。

示例（登录表单）：
TITLE 账号登录
FIELD 邮箱 email
FIELD 密码 password password
CHECK 记住我 remember
BUTTON 登录 login

只输出界面块。`;

const requests = [
  '做一个邮箱和密码登录表单，带记住我和登录按钮',
  '商品卡片：无线降噪耳机，1999 元，有图片、卖点和加入购物车按钮',
  '上海今天天气卡片，26 度多云，湿度 65%，东南风 3 级，提醒带伞',
  '做一个会议预约表单：姓名、部门下拉、日期、时间段、备注、提交按钮',
  '做一个个人资料卡：头像、张三、产品经理、北京、邮箱 zhangsan@example.com',
];

for (const request of requests) {
  const response = await fetch('http://127.0.0.1:8000/v1/chat/completions', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      model: 'qwen3.5:4b',
      messages: [
        {role: 'system', content: system},
        {role: 'user', content: `生成 UI：${request}`},
      ],
      temperature: 0,
      max_tokens: 700,
      stream: false,
    }),
    signal: AbortSignal.timeout(240000),
  });
  const data = await response.json();
  console.log(`\n===== ${request} =====`);
  console.log(data.choices?.[0]?.message?.content ?? JSON.stringify(data));
  console.error('USAGE', JSON.stringify(data.usage));
}
