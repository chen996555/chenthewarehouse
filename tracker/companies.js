'use strict';

/**
 * 求职星计划 — 目标公司注册表（阶段 2 框架核心）
 *
 * 每家公司标好：用哪套招聘系统（adapter）+ 抓取参数 + 状态。
 * adapter 取值：
 *   'zhiye'  —— 北森 zhiye.com，已实现
 *   null     —— 自研/其他招聘系统，待适配（pending）
 *
 * 抓取时按 company.name 查表 → 分发到对应适配器，前端不用关心底层系统细节。
 */

// 公司覆盖层 apply.overrides：候选链（登录方式/解析按钮/字段名/下拉）没覆盖的特例，验证阶段发现后回填。
// 字段约定（候选链默认覆盖的不填，只有特例才填）：
//   applyButtonText   投递按钮文本（候选链默认找「投递/申请/apply」）
//   parseButtonSelector 解析按钮额外选择器（候选链默认找 span/button/短文本）
//   fieldLabelAttr    字段名来源覆盖（候选链默认 data属性/label/placeholder）
//   dropdownSelector  下拉选项选择器覆盖（候选链默认 role=combobox/class含select）
const COMPANIES = [
  // ============ 互联网大厂（自研招聘系统，待适配） ============
  { group: '互联网', name: '腾讯', adapter: 'tx', url: 'https://join.qq.com', reach: { type: 'direct', urlTemplate: 'https://join.qq.com/post.html?postId={id}' } },
  { group: '互联网', name: '阿里巴巴', adapter: 'ali', url: 'https://campus-talent.alibaba.com/campus/position', reach: { type: 'direct', urlTemplate: 'https://campus-talent.alibaba.com/campus/position/{id}?deptCodes=' } },
  { group: '互联网', name: '字节跳动', adapter: 'byte', url: 'https://jobs.bytedance.com', reach: { type: 'direct', urlTemplate: 'https://jobs.bytedance.com/campus/position/{id}/detail' } },
  { group: '互联网', name: '美团', adapter: 'mt', url: 'https://zhaopin.meituan.com/web/campus', reach: { type: 'navigate', entryUrl: 'https://zhaopin.meituan.com/web/campus' } },
  { group: '互联网', name: '京东', adapter: 'jd', url: 'https://campus.jd.com', reach: { type: 'direct', urlTemplate: 'https://campus.jd.com/#/details?id={id}' } },
  { group: '互联网', name: '网易', adapter: 'ne', url: 'https://campus.163.com', reach: { type: 'direct', urlTemplate: 'https://campus.163.com/app/detail/index?id={id}&projectId=103' } },
  { group: '互联网', name: '百度', adapter: 'baidu', url: 'https://talent.baidu.com', reach: { type: 'direct', urlTemplate: 'https://talent.baidu.com/jobs/detail/GRADUATE/{id}' } },
  { group: '互联网', name: '拼多多', adapter: 'pdd', url: 'https://careers.pddglobalhr.com/campus/grad', reach: { type: 'direct', urlTemplate: 'https://careers.pddglobalhr.com/campus/grad/detail?positionId={id}' } },
  { group: '互联网', name: '快手', adapter: 'ks', url: 'https://campus.kuaishou.cn', reach: { type: 'direct', urlTemplate: 'https://campus.kuaishou.cn/recruit/campus/e/#/campus/job-info/{id}' } },
  { group: '互联网', name: '小红书', adapter: 'xhs', url: 'https://job.xiaohongshu.com', reach: { type: 'direct', urlTemplate: 'https://job.xiaohongshu.com/social/position/{id}' } },
  { group: '互联网', name: '哔哩哔哩', adapter: 'bili', url: 'https://jobs.bilibili.com', reach: { type: 'navigate', entryUrl: 'https://jobs.bilibili.com/campus/positions' } },
  { group: '互联网', name: '滴滴', adapter: 'moka', moka: { org: 'didiglobal', siteId: '96064', base: 'https://campus.didiglobal.com', pathPrefix: 'campus_apply', section: 'campus' }, url: 'https://campus.didiglobal.com' },
  { group: '互联网', name: '蚂蚁集团', adapter: 'ant', url: 'https://talent.antgroup.com' },
  { group: '互联网', name: '小米', adapter: 'byte', byte: { base: 'https://xiaomi.jobs.f.mioffice.cn', campusPath: '/campus/' }, url: 'https://xiaomi.jobs.f.mioffice.cn', reach: { type: 'direct', urlTemplate: 'https://xiaomi.jobs.f.mioffice.cn/campus/position/{id}/detail' } },
  { group: '互联网', name: '华为', adapter: 'huawei', url: 'https://career.huawei.com', reach: { type: 'direct', urlTemplate: 'https://career.huawei.com/reccampportal/portal5/campus-recruitment-detail.html?jobId={id}' } },
  { group: '互联网', name: 'OPPO', adapter: 'oppo', url: 'https://careers.oppo.com', reach: { type: 'direct', urlTemplate: 'https://careers.oppo.com/#/campus/talent/positionDetail/{id}' } },
  { group: '互联网', name: 'vivo', adapter: 'vivo', url: 'https://hr-campus.vivo.com', reach: { type: 'direct', urlTemplate: 'https://hr-campus.vivo.com/zpdetail/{id}' } },
  { group: '互联网', name: '米哈游', adapter: 'mhy', url: 'https://jobs.mihoyo.com', reach: { type: 'direct', urlTemplate: 'https://jobs.mihoyo.com/#/campus/position/{id}' } },
  { group: '互联网', name: '大疆', adapter: 'moka', moka: { org: 'dji', siteId: '143359', base: 'https://apply.careers.dji.com', section: 'campus' }, url: 'https://careers.dji.com' },
  { group: '互联网', name: '商汤', adapter: 'byte', byte: { base: 'https://hr-jobs.sensetime.com', campusPath: '/edu/' }, url: 'https://hr-jobs.sensetime.com', reach: { type: 'direct', urlTemplate: 'https://hr-jobs.sensetime.com/edu/position/{id}/detail' } },
  { group: '互联网', name: '贝壳', adapter: null, url: 'https://job.ke.com' },
  // zhiye/hotjob 系统（免费点亮）
  { group: '互联网', name: '科大讯飞', adapter: 'zhiye', subdomain: 'iflytek', path: 'campus/jobs' },
  { group: '互联网', name: '360', adapter: 'zhiye', subdomain: '360campus', path: 'campus/jobs' },
  { group: '互联网', name: '荣耀', adapter: 'hotjob', suiteId: 'SU60eea919bef57c1023f6fe78', base: 'https://career.honor.com', url: 'https://career.honor.com', reach: { type: 'direct', urlTemplate: 'https://career.honor.com/SU60eea919bef57c1023f6fe78/pb/posDetail.html?postId={id}&postType=campus' } },
  // Moka 系统（moka 适配器）
  { group: '互联网', name: '携程', adapter: 'ctrip', url: 'https://job.ctrip.com', reach: { type: 'direct', urlTemplate: 'https://job.ctrip.com/campus-recruitment/trip/37757#/campus/job-detail/{id}' } },
  { group: '互联网', name: '唯品会', adapter: 'moka', moka: { org: 'vipshophr', siteId: '10039', base: 'https://app-tc.mokahr.com', section: 'campus' }, url: 'https://app-tc.mokahr.com/campus-recruitment/vipshophr/10039' },
  { group: '互联网', name: '新浪微博', adapter: 'moka', moka: { org: 'sina', siteId: '43535', base: 'https://career.sina.com.cn', section: 'social' }, url: 'https://career.sina.com.cn/social-recruitment/sina/43535/' },
  { group: '互联网', name: '搜狐', adapter: 'moka', moka: { org: 'sohu', siteId: '43256', base: 'https://hr.sohu.com', section: 'social' }, url: 'https://hr.sohu.com/social-recruitment/sohu/43256' },
  { group: '互联网', name: '爱奇艺', adapter: 'zhiye', subdomain: 'iqiyi', path: 'campus/jobs' },
  { group: '互联网', name: '得物', adapter: 'byte', byte: { base: 'https://campus.dewu.com', campusPath: '/578078/position/' }, url: 'https://campus.dewu.com', reach: { type: 'direct', urlTemplate: 'https://campus.dewu.com/578078/position/{id}/detail' } },
  // Moka 家族扩展（参考 job-pro，org/siteId 已逆向）
  { group: '互联网', name: '寒武纪', adapter: 'moka', moka: { org: 'cambricon', siteId: '44201', base: 'https://app.mokahr.com', section: 'campus' }, url: 'https://app.mokahr.com/campus-recruitment/cambricon/44201' },
  { group: '互联网', name: 'DeepSeek', adapter: 'moka', moka: { org: 'high-flyer', siteId: '140576', base: 'https://app.mokahr.com', section: 'social' }, url: 'https://app.mokahr.com/social-recruitment/high-flyer/140576' },
  { group: '互联网', name: '银河通用', adapter: 'moka', moka: { org: 'yinhetongyong', siteId: '165929', base: 'https://app.mokahr.com', section: 'social' }, url: 'https://app.mokahr.com/social-recruitment/yinhetongyong/165929' },
  { group: '互联网', name: '吉利', adapter: 'moka', moka: { org: 'geely', siteId: '96123', base: 'https://app.mokahr.com', section: 'social' }, url: 'https://app.mokahr.com/social-recruitment/geely/96123' },
  { group: '互联网', name: '旷视', adapter: 'moka', moka: { org: 'megviihr', siteId: '38642', base: 'https://app.mokahr.com', pathPrefix: 'campus_apply', section: 'campus' }, url: 'https://app.mokahr.com/campus_apply/megviihr/38642' },
  { group: '互联网', name: '阶跃星辰', adapter: 'moka', moka: { org: 'step', siteId: '94904', base: 'https://app.mokahr.com', section: 'social' }, url: 'https://app.mokahr.com/social-recruitment/step/94904' },
  // 飞书 ATSX 家族扩展（host + campusPath 已逆向）
  { group: '互联网', name: '百川智能', adapter: 'byte', byte: { base: 'https://cq6qe6bvfr6.jobs.feishu.cn', socialPath: '/baichuanzhaopin/position/', section: 'social' }, url: 'https://cq6qe6bvfr6.jobs.feishu.cn', reach: { type: 'direct', urlTemplate: 'https://cq6qe6bvfr6.jobs.feishu.cn/baichuanzhaopin/position/{id}/detail' } },
  { group: '互联网', name: 'MiniMax', adapter: 'byte', byte: { base: 'https://vrfi1sk8a0.jobs.feishu.cn', campusPath: '/379481/position/' }, url: 'https://vrfi1sk8a0.jobs.feishu.cn', reach: { type: 'direct', urlTemplate: 'https://vrfi1sk8a0.jobs.feishu.cn/379481/position/{id}/detail' } },
  { group: '互联网', name: '蔚来', adapter: 'byte', byte: { base: 'https://nio.jobs.feishu.cn', campusPath: '/campus/' }, url: 'https://nio.jobs.feishu.cn', reach: { type: 'direct', urlTemplate: 'https://nio.jobs.feishu.cn/campus/position/{id}/detail' } },
  { group: '互联网', name: '零一万物', adapter: 'byte', byte: { base: 'https://01ai.jobs.feishu.cn', socialPath: '/index/position/', section: 'social' }, url: 'https://01ai.jobs.feishu.cn', reach: { type: 'direct', urlTemplate: 'https://01ai.jobs.feishu.cn/index/position/{id}/detail' } },
  { group: '互联网', name: '智谱', adapter: 'byte', byte: { base: 'https://zhipu-ai.jobs.feishu.cn', socialPath: '/index/position/', section: 'social' }, url: 'https://zhipu-ai.jobs.feishu.cn', reach: { type: 'direct', urlTemplate: 'https://zhipu-ai.jobs.feishu.cn/index/position/{id}/detail' } },
  { group: '互联网', name: '智元机器人', adapter: 'byte', byte: { base: 'https://agirobot.jobs.feishu.cn', campusPath: '/campusrecruitment/position/' }, url: 'https://agirobot.jobs.feishu.cn', reach: { type: 'direct', urlTemplate: 'https://agirobot.jobs.feishu.cn/campusrecruitment/position/{id}/detail' } },
  { group: '互联网', name: '完美世界', adapter: 'moka', moka: { org: 'pwrd', siteId: '140155', base: 'https://app.mokahr.com', pathPrefix: 'campus_apply', section: 'campus' }, url: 'https://app.mokahr.com/campus_apply/pwrd/140155' },
  { group: '互联网', name: '鹰角网络', adapter: 'moka', moka: { org: 'hypergryph', siteId: '26326', base: 'https://app.mokahr.com', pathPrefix: 'campus_apply', section: 'campus' }, url: 'https://app.mokahr.com/campus_apply/hypergryph/26326' },
  // 自研系统（接口已逆向，参考 job-pro）
  { group: '互联网', name: '顺丰', adapter: 'sf', url: 'https://campus.sf-express.com', reach: { type: 'direct', urlTemplate: 'https://campus.sf-express.com/#/postDetail/{id}' } },
  { group: '互联网', name: '理想汽车', adapter: 'liauto', url: 'https://www.lixiang.com/employ/campus.html', reach: { type: 'direct', urlTemplate: 'https://www.lixiang.com/job/detail/{id}.html' } },
  { group: '互联网', name: '比亚迪', adapter: 'byd', url: 'https://job.byd.com', reach: { type: 'direct', urlTemplate: 'https://job.byd.com/portal/pc/#/social/detail?positionCode={id}' } },
  { group: '互联网', name: '中国平安', adapter: 'pingan', url: 'https://campus.pingan.com', reach: { type: 'direct', urlTemplate: 'https://campus.pingan.com/positionDetail?positionId={id}' } },
  { group: '互联网', name: '地平线', adapter: 'wecruit', suiteId: 'SU6409ef49bef57c635fd390a6', url: 'https://wecruit.hotjob.cn', reach: { type: 'direct', urlTemplate: 'https://wecruit.hotjob.cn/SU6409ef49bef57c635fd390a6/pb/detail.html?postId={id}' } },

  // ============ 金融（系统分散：zhiye / 北森微招聘 / 大易 / 自研） ============
  { group: '金融', name: '中国人寿（广发银行）', adapter: 'zhiye', subdomain: 'chinalife' },
  { group: '金融', name: '中国银河证券', adapter: 'zhiye', subdomain: 'chinastock', path: 'custom/campus' },
  { group: '金融', name: '光大证券', adapter: 'zhiye', subdomain: 'ebscn', path: 'campus/jobs' },
  { group: '金融', name: '国金证券', adapter: 'zhiye', subdomain: 'gjzq', path: 'campus/jobs' },
  { group: '金融', name: '工商银行', adapter: null, system: '自研', url: 'https://job.icbc.com.cn' },
  { group: '金融', name: '建设银行', adapter: null, system: '自研', url: 'https://job.ccb.com' },
  { group: '金融', name: '农业银行', adapter: null, system: '自研', url: 'https://career.abchina.com.cn' },
  { group: '金融', name: '中国银行', adapter: null, system: '自研', url: '' },
  { group: '金融', name: '招商银行', adapter: null, system: '自研', url: 'https://career.cmbchina.com' },
  { group: '金融', name: '中国平安', adapter: null, system: '自研', url: 'https://talent.pingan.com' },
  { group: '金融', name: '中信证券', adapter: null, system: '自研', url: '' },
  { group: '金融', name: '国泰君安', adapter: null, system: '自研', url: 'https://hr.gtja.com' },
  { group: '金融', name: '南方基金', adapter: 'hotjob', suiteId: 'SU6138665dbef57c3b63841399', url: 'https://wecruit.hotjob.cn/SU6138665dbef57c3b63841399/pb/index.html' },
  { group: '金融', name: '广发证券', adapter: 'hotjob', suiteId: 'SU625527c30dcad4021443cdda', url: 'https://wecruit.hotjob.cn/SU625527c30dcad4021443cdda/pb/index.html' },
  { group: '金融', name: '华泰证券', adapter: 'hotjob', suiteId: 'SU6419745cbef57c635fe10142', url: 'https://wecruit.hotjob.cn/SU6419745cbef57c635fe10142/pb/index.html' },
  { group: '金融', name: '中信银行', adapter: null, system: '用友大易', url: '' },
  { group: '金融', name: '兴业银行', adapter: null, system: '用友大易', url: '' },
  { group: '金融', name: '易方达基金', adapter: null, system: '自研', url: '' },
  { group: '金融', name: '华夏基金', adapter: null, system: '自研', url: '' },
  { group: '金融', name: '广发基金', adapter: null, system: '用友大易', url: '' },

  // ============ 已适配 zhiye 的其他公司 ============
  { group: '科技/互联网', name: '北森', adapter: 'zhiye', subdomain: 'beisen' },
  { group: '科技/互联网', name: '金证科技', adapter: 'zhiye', subdomain: 'szkingdom1' },
  { group: '科技/互联网', name: '鼎桥技术', adapter: 'zhiye', subdomain: 'td-tech' },
  { group: '科技/互联网', name: '光宝科技', adapter: 'zhiye', subdomain: 'liteon' },
  { group: '科技/互联网', name: '水晶光电', adapter: 'zhiye', subdomain: 'crystal-optech1' },
  { group: '制造/汽车', name: '三一集团', adapter: 'zhiye', subdomain: 'sany' },
  { group: '制造/汽车', name: '奇瑞汽车', adapter: 'zhiye', subdomain: 'chery' },
  { group: '制造/汽车', name: '欣旺达', adapter: 'zhiye', subdomain: 'sunwodacampus' },
  { group: '央企/国企', name: '中国建筑集团', adapter: 'zhiye', subdomain: 'cscec' },
  { group: '央企/国企', name: '中国外运', adapter: 'zhiye', subdomain: 'sinotrans' },
  { group: '央企/国企', name: '中国通用技术集团', adapter: 'zhiye', subdomain: 'genertec' },
  { group: '央企/国企', name: '航天三院', adapter: 'zhiye', subdomain: 'casic' },
  { group: '央企/国企', name: '中国航发黎明', adapter: 'zhiye', subdomain: 'aeccslaeg' },
  { group: '央企/国企', name: '湖北联投', adapter: 'zhiye', subdomain: 'hblt' },
  { group: '央企/国企', name: '广东南粤集团', adapter: 'zhiye', subdomain: 'gdadri' },
  { group: '医药/健康', name: '药明康德', adapter: 'zhiye', subdomain: 'wuxiapptec' },
  { group: '医药/健康', name: '泰德制药', adapter: 'zhiye', subdomain: 'tidepharm' },
  { group: '医药/健康', name: '晶易医药', adapter: 'zhiye', subdomain: 'king-eagle' },
  { group: '医药/健康', name: '艾迪医药', adapter: 'zhiye', subdomain: 'aidea' },
  { group: '半导体/存储', name: '长江存储', adapter: 'zhiye', subdomain: 'ymtc' },
  { group: '半导体/存储', name: '江波龙', adapter: 'zhiye', subdomain: 'longsys', path: 'campus/jobs' },
  { group: '半导体/存储', name: '兆易创新', adapter: 'moka', moka: { org: 'gigadevice', siteId: '92215', base: 'https://app.mokahr.com', section: 'campus' }, url: 'https://app.mokahr.com/campus-recruitment/gigadevice/92215' },
  { group: '半导体/存储', name: '佰维存储', adapter: 'zhiye', subdomain: 'biwin', path: 'campus/jobs' },
  { group: '半导体/存储', name: '长鑫存储', adapter: 'zhiye', subdomain: 'cxmt', path: 'campus/jobs' },
  { group: '半导体/存储', name: '中国电科36所', adapter: 'zhiye', subdomain: 'cetc36' },
  { group: '化工/材料', name: '金发科技', adapter: 'zhiye', subdomain: 'kingfa' },
  { group: '互联网', name: '三七互娱', adapter: 'moka', moka: { org: '37', siteId: '58016', base: 'https://app.mokahr.com', pathPrefix: 'campus_apply', section: 'campus' }, url: 'https://app.mokahr.com/campus_apply/37/58016' },
  { group: '互联网', name: '莉莉丝游戏', adapter: 'byte', byte: { base: 'https://lilithgames.jobs.feishu.cn', campusPath: '/campus/position/', section: 'campus' }, url: 'https://lilithgames.jobs.feishu.cn', reach: { type: 'direct', urlTemplate: 'https://lilithgames.jobs.feishu.cn/campus/position/{id}/detail' } },
  { group: '互联网', name: '趣加', adapter: 'moka', moka: { org: 'funplus01', siteId: '147931', base: 'https://app.mokahr.com', pathPrefix: 'campus-recruitment', section: 'campus' }, url: 'https://app.mokahr.com/campus-recruitment/funplus01/147931' },
  { group: '互联网', name: '巨人网络', adapter: 'moka', moka: { org: 'ztgame', siteId: '92438', base: 'https://app.mokahr.com', pathPrefix: 'campus_apply', section: 'campus' }, url: 'https://app.mokahr.com/campus_apply/ztgame/92438' },
  { group: '互联网', name: '库洛游戏', adapter: 'byte', byte: { base: 'https://kurogame.jobs.feishu.cn', campusPath: '/campus/position/', section: 'campus' }, url: 'https://kurogame.jobs.feishu.cn', reach: { type: 'direct', urlTemplate: 'https://kurogame.jobs.feishu.cn/campus/position/{id}/detail' } },
  { group: '互联网', name: '紫龙游戏', adapter: 'moka', moka: { org: 'zlongame', siteId: '140110', base: 'https://app.mokahr.com', pathPrefix: 'campus-recruitment', section: 'campus' }, url: 'https://app.mokahr.com/campus-recruitment/zlongame/140110' },
  { group: '互联网', name: '沐瞳科技', adapter: 'byte', byte: { base: 'https://moonton.jobs.feishu.cn', campusPath: '/campus/position/', section: 'campus' }, url: 'https://moonton.jobs.feishu.cn', reach: { type: 'direct', urlTemplate: 'https://moonton.jobs.feishu.cn/campus/position/{id}/detail' } },
  { group: '互联网', name: '悠星网络', adapter: 'moka', moka: { org: 'yostar', siteId: '26843', base: 'https://app.mokahr.com', pathPrefix: 'apply', section: 'campus' }, url: 'https://app.mokahr.com/apply/yostar/26843' },
  { group: '互联网', name: '散爆网络', adapter: 'moka', moka: { org: 'micateam', siteId: '146166', base: 'https://app.mokahr.com', pathPrefix: 'campus-recruitment', section: 'campus' }, url: 'https://app.mokahr.com/campus-recruitment/micateam/146166' },
  { group: '互联网', name: '掌趣科技', adapter: 'moka', moka: { org: 'playcrab', siteId: '43628', base: 'https://app.mokahr.com', pathPrefix: 'campus_apply', section: 'campus' }, url: 'https://app.mokahr.com/campus_apply/playcrab/43628' },
  { group: '互联网', name: '盛趣游戏', adapter: 'moka', moka: { org: 'shengqu', siteId: '96336', base: 'https://app.mokahr.com', pathPrefix: 'campus-recruitment', section: 'campus' }, url: 'https://app.mokahr.com/campus-recruitment/shengqu/96336' },
  { group: '互联网', name: '点触科技', adapter: 'moka', moka: { org: 'dianchu', siteId: '144217', base: 'https://app.mokahr.com', pathPrefix: 'campus-recruitment', section: 'campus' }, url: 'https://app.mokahr.com/campus-recruitment/dianchu/144217' },
  { group: '互联网', name: '汇顶科技', adapter: 'zhiye', subdomain: 'goodix', path: 'campus/jobs' },
  { group: '互联网', name: '豪威集团', adapter: 'zhiye', subdomain: 'ovt-omnivision', path: 'campus/jobs' },
  { group: '互联网', name: '晶合集成', adapter: 'zhiye', subdomain: 'nexchip', path: 'campus/jobs' },
  { group: '互联网', name: '华海清科', adapter: 'zhiye', subdomain: 'hwatsing1', path: 'campus/jobs' },
  { group: '互联网', name: '卓胜微', adapter: 'zhiye', subdomain: 'maxscend', path: 'campus/jobs' },
  { group: '互联网', name: '恒玄科技', adapter: 'zhiye', subdomain: 'bestechnic', path: 'campus/jobs' },
  { group: '互联网', name: '华虹集团', adapter: 'moka', moka: { org: 'huahong', siteId: '78009', base: 'https://app.mokahr.com', pathPrefix: 'campus-recruitment', section: 'campus' }, url: 'https://app.mokahr.com/campus-recruitment/huahong/78009' },
  { group: '互联网', name: '中微公司', adapter: 'moka', moka: { org: 'amec', siteId: '4362', base: 'https://app.mokahr.com', pathPrefix: 'campus_apply', section: 'campus' }, url: 'https://app.mokahr.com/campus_apply/amec/4362' },
  { group: '互联网', name: '斯达半导', adapter: 'moka', moka: { org: 'powersemi', siteId: '101981', base: 'https://app.mokahr.com', pathPrefix: 'campus-recruitment', section: 'campus' }, url: 'https://app.mokahr.com/campus-recruitment/powersemi/101981' },
  { group: '互联网', name: '思瑞浦', adapter: 'moka', moka: { org: '3peakic', siteId: '67894', base: 'https://app.mokahr.com', pathPrefix: 'campus-recruitment', section: 'campus' }, url: 'https://app.mokahr.com/campus-recruitment/3peakic/67894' },
  { group: '互联网', name: '紫光展锐', adapter: 'wecruit', suiteId: 'SU62964975bef57c6df7b40e20', url: 'https://wecruit.hotjob.cn', reach: { type: 'direct', urlTemplate: 'https://wecruit.hotjob.cn/SU62964975bef57c6df7b40e20/pb/detail.html?postId={id}' } },
  { group: '互联网', name: '长安汽车', adapter: 'zhiye', subdomain: 'changan', path: 'campus/jobs' },
  { group: '互联网', name: '小鹏汽车', adapter: 'byte', byte: { base: 'https://xiaopeng.jobs.feishu.cn', campusPath: '/campus/position/', section: 'campus' }, url: 'https://xiaopeng.jobs.feishu.cn', reach: { type: 'direct', urlTemplate: 'https://xiaopeng.jobs.feishu.cn/campus/position/{id}/detail' } },
  { group: '互联网', name: '零跑汽车', adapter: 'zhiye', subdomain: 'leapmotor', path: 'campus/jobs' },
  { group: '互联网', name: '赛力斯', adapter: 'zhiye', subdomain: 'sokon', path: 'campus/jobs' },
  { group: '互联网', name: '宁德时代', adapter: 'moka', moka: { org: 'catlhr', siteId: '148948', base: 'https://app.mokahr.com', pathPrefix: 'campus-recruitment', section: 'campus' }, url: 'https://app.mokahr.com/campus-recruitment/catlhr/148948' },
  { group: '互联网', name: '亿纬锂能', adapter: 'wecruit', suiteId: 'SU630487ca0dcad45aa7768a79', url: 'https://wecruit.hotjob.cn', reach: { type: 'direct', urlTemplate: 'https://wecruit.hotjob.cn/SU630487ca0dcad45aa7768a79/pb/detail.html?postId={id}' } },
  { group: '互联网', name: '阳光电源', adapter: 'moka', moka: { org: 'sungrow', siteId: '94416', base: 'https://app.mokahr.com', pathPrefix: 'campus-recruitment', section: 'campus' }, url: 'https://app.mokahr.com/campus-recruitment/sungrow/94416' },
  { group: '互联网', name: '先导智能', adapter: 'zhiye', subdomain: 'leadchina', path: 'campus/jobs' },
  { group: '互联网', name: '歌尔股份', adapter: 'wecruit', suiteId: 'SU65dd9ebd1c240e4b11c4f491', url: 'https://wecruit.hotjob.cn', reach: { type: 'direct', urlTemplate: 'https://wecruit.hotjob.cn/SU65dd9ebd1c240e4b11c4f491/pb/detail.html?postId={id}' } },
  { group: '互联网', name: '三一重工', adapter: 'zhiye', subdomain: 'sanycampus', path: 'campus/jobs' },
  { group: '互联网', name: '徐工集团', adapter: 'moka', moka: { org: 'xcmg', siteId: '148091', base: 'https://app.mokahr.com', pathPrefix: 'campus-recruitment', section: 'campus' }, url: 'https://app.mokahr.com/campus-recruitment/xcmg/148091' },
  { group: '互联网', name: '中联重科', adapter: 'wecruit', suiteId: 'SU60a6449a2f9d2430fdc11a19', url: 'https://wecruit.hotjob.cn', reach: { type: 'direct', urlTemplate: 'https://wecruit.hotjob.cn/SU60a6449a2f9d2430fdc11a19/pb/detail.html?postId={id}' } },
  { group: '互联网', name: '柳工', adapter: 'wecruit', suiteId: 'SU6132e87abef57c3b637dcb71', url: 'https://wecruit.hotjob.cn', reach: { type: 'direct', urlTemplate: 'https://wecruit.hotjob.cn/SU6132e87abef57c3b637dcb71/pb/detail.html?postId={id}' } },
  { group: '互联网', name: '嘉实基金', adapter: 'moka', moka: { org: 'jsfund', siteId: '43906', base: 'https://app.mokahr.com', pathPrefix: 'campus_apply', section: 'campus' }, url: 'https://app.mokahr.com/campus_apply/jsfund/43906' },
  { group: '互联网', name: '中国人保', adapter: 'zhiye', subdomain: 'picc', path: 'campus/jobs' },
  { group: '互联网', name: '中国太平洋保险', adapter: 'moka', moka: { org: 'cpicproperty', siteId: '150956', base: 'https://app.mokahr.com', pathPrefix: 'campus-recruitment', section: 'campus' }, url: 'https://app.mokahr.com/campus-recruitment/cpicproperty/150956' },
  { group: '互联网', name: '泰康保险', adapter: 'zhiye', subdomain: 'jobtaikang', path: 'campus/jobs' },
  { group: '互联网', name: '新华保险', adapter: 'zhiye', subdomain: 'nci', path: 'campus/jobs' },
  { group: '互联网', name: '乐元素', adapter: 'moka', moka: { org: 'leyuansu', siteId: '164275', base: 'https://app.mokahr.com', pathPrefix: 'campus-recruitment', section: 'campus' }, url: 'https://app.mokahr.com/campus-recruitment/leyuansu/164275' },
  { group: '互联网', name: '祖龙娱乐', adapter: 'moka', moka: { org: 'zulong', siteId: '25158', base: 'https://app.mokahr.com', pathPrefix: 'campus-recruitment', section: 'campus' }, url: 'https://app.mokahr.com/campus-recruitment/zulong/25158' },
  { group: '半导体/存储', name: '全志科技', adapter: 'moka', moka: { org: 'allwinnertech', siteId: '43436', base: 'https://app.mokahr.com', pathPrefix: 'campus-recruitment', section: 'campus' }, url: 'https://app.mokahr.com/campus-recruitment/allwinnertech/43436' },
  { group: '半导体/存储', name: '瑞芯微', adapter: 'moka', moka: { org: 'rock-chips', siteId: '44102', base: 'https://app.mokahr.com', pathPrefix: 'campus-recruitment', section: 'campus' }, url: 'https://app.mokahr.com/campus-recruitment/rock-chips/44102' },
  { group: '半导体/存储', name: '三安光电', adapter: 'zhiye', subdomain: 'sanan-e', path: 'campus/jobs' },
  { group: '制造/汽车', name: '长城汽车', adapter: 'wecruit', suiteId: 'SU692d3058ea11b01b6c54d0ea', url: 'https://wecruit.hotjob.cn', reach: { type: 'direct', urlTemplate: 'https://wecruit.hotjob.cn/SU692d3058ea11b01b6c54d0ea/pb/detail.html?postId={id}' } },
  { group: '制造/汽车', name: 'TCL', adapter: 'wecruit', suiteId: 'SU64893571bef57c16d356b99e', url: 'https://wecruit.hotjob.cn', reach: { type: 'direct', urlTemplate: 'https://wecruit.hotjob.cn/SU64893571bef57c16d356b99e/pb/detail.html?postId={id}' } },
  { group: '互联网', name: '中核集团', adapter: 'zhiye', subdomain: 'cnnc', path: 'campus/jobs' },
  { group: '互联网', name: '中国铁建', adapter: 'zhiye', subdomain: 'crcci', path: 'campus/jobs' },
  { group: '互联网', name: '中国交建', adapter: 'zhiye', subdomain: 'ccccltd', path: 'campus/jobs' },
  { group: '互联网', name: '招商局集团', adapter: 'zhiye', subdomain: 'cmhk', path: 'campus/jobs' },
  { group: '互联网', name: '中国兵器工业集团', adapter: 'zhiye', subdomain: 'norincogroupzhaopin', path: 'campus/jobs' },
  { group: '互联网', name: '中国船舶集团', adapter: 'zhiye', subdomain: 'cssc', path: 'campus/jobs' },
  { group: '互联网', name: '中国中化', adapter: 'wecruit', suiteId: 'SU610b91ee0dcad4106ff11c21', url: 'https://wecruit.hotjob.cn', reach: { type: 'direct', urlTemplate: 'https://wecruit.hotjob.cn/SU610b91ee0dcad4106ff11c21/pb/detail.html?postId={id}' } },
  { group: '互联网', name: '恒瑞医药', adapter: 'moka', moka: { org: 'hengrui', siteId: '145997', base: 'https://app.mokahr.com', pathPrefix: 'campus-recruitment', section: 'campus' }, url: 'https://app.mokahr.com/campus-recruitment/hengrui/145997' },
  { group: '互联网', name: '上海医药', adapter: 'moka', moka: { org: 'sphchina', siteId: '37653', base: 'https://app.mokahr.com', pathPrefix: 'campus_apply', section: 'campus' }, url: 'https://app.mokahr.com/campus_apply/sphchina/37653' },
  { group: '互联网', name: '智飞生物', adapter: 'moka', moka: { org: 'zfsw', siteId: '46252', base: 'https://app.mokahr.com', pathPrefix: 'campus-recruitment', section: 'campus' }, url: 'https://app.mokahr.com/campus-recruitment/zfsw/46252' },
  { group: '互联网', name: '康龙化成', adapter: 'moka', moka: { org: 'pharmaron', siteId: '74162', base: 'https://app.mokahr.com', pathPrefix: 'campus-recruitment', section: 'campus' }, url: 'https://app.mokahr.com/campus-recruitment/pharmaron/74162' },
  { group: '互联网', name: '微创医疗', adapter: 'moka', moka: { org: 'microport', siteId: '56155', base: 'https://app.mokahr.com', pathPrefix: 'campus-recruitment', section: 'campus' }, url: 'https://app.mokahr.com/campus-recruitment/microport/56155' },
  { group: '互联网', name: '联影医疗', adapter: 'zhiye', subdomain: 'united-imaging', path: 'campus/jobs' },
  { group: '互联网', name: '信达生物', adapter: 'zhiye', subdomain: 'innoventbio', path: 'campus/jobs' },
  { group: '互联网', name: '复星医药', adapter: 'zhiye', subdomain: 'fosunpharma', path: 'campus/jobs' },
  { group: '互联网', name: '正大天晴', adapter: 'zhiye', subdomain: 'cttq', path: 'campus/jobs' },
  { group: '互联网', name: '齐鲁制药', adapter: 'zhiye', subdomain: 'qilu-pharma', path: 'campus/jobs' },
  { group: '互联网', name: '君实生物', adapter: 'zhiye', subdomain: 'junshibiosciences', path: 'campus/jobs' },
  { group: '互联网', name: '三生制药', adapter: 'zhiye', subdomain: '3sbio', path: 'campus/jobs' },
  { group: '互联网', name: '泰格医药', adapter: 'zhiye', subdomain: 'tigermed', path: 'campus/jobs' },
  { group: '互联网', name: '翰森制药', adapter: 'zhiye', subdomain: 'hspharm', path: 'campus/jobs' },
  { group: '互联网', name: '威高集团', adapter: 'zhiye', subdomain: 'weigao', path: 'campus/jobs' },
  { group: '互联网', name: '鱼跃医疗', adapter: 'zhiye', subdomain: 'yuwellhr', path: 'campus/jobs' },
  { group: '互联网', name: '华大基因', adapter: 'zhiye', subdomain: 'genomics', path: 'campus/jobs' },
  { group: '互联网', name: '凯莱英', adapter: 'zhiye', subdomain: 'asymchem', path: 'campus/jobs' },
  { group: '互联网', name: '华润三九', adapter: 'wecruit', suiteId: 'SU613834ecbef57c3b6383b50e', url: 'https://wecruit.hotjob.cn', reach: { type: 'direct', urlTemplate: 'https://wecruit.hotjob.cn/SU613834ecbef57c3b6383b50e/pb/detail.html?postId={id}' } },
  { group: '互联网', name: '金风科技', adapter: 'zhiye', subdomain: 'goldwind', path: 'campus/jobs' },
  { group: '互联网', name: '晶科能源', adapter: 'moka', moka: { org: 'jinkosolar', siteId: '41896', base: 'https://app.mokahr.com', pathPrefix: 'campus-recruitment', section: 'campus' }, url: 'https://app.mokahr.com/campus-recruitment/jinkosolar/41896' },
];

// 按 group 分组返回（供前端下拉）
function getCompanies() {
  const groups = {};
  for (const c of COMPANIES) (groups[c.group] ||= []).push(c);
  return Object.entries(groups).map(([group, companies]) => ({ group, companies }));
}

function findCompany(name) {
  return COMPANIES.find((c) => c.name === name);
}

module.exports = { COMPANIES, getCompanies, findCompany };
