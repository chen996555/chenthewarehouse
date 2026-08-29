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
  { group: '互联网', name: '百度', adapter: null, url: 'https://talent.baidu.com' },
  { group: '互联网', name: '拼多多', adapter: 'pdd', url: 'https://careers.pddglobalhr.com/campus/grad', reach: { type: 'direct', urlTemplate: 'https://careers.pddglobalhr.com/campus/grad/detail?positionId={id}' } },
  { group: '互联网', name: '快手', adapter: 'ks', url: 'https://campus.kuaishou.cn', reach: { type: 'direct', urlTemplate: 'https://campus.kuaishou.cn/recruit/campus/e/#/campus/job-info/{id}' } },
  { group: '互联网', name: '小红书', adapter: 'xhs', url: 'https://job.xiaohongshu.com', reach: { type: 'direct', urlTemplate: 'https://job.xiaohongshu.com/social/position/{id}' } },
  { group: '互联网', name: '哔哩哔哩', adapter: 'bili', url: 'https://jobs.bilibili.com', reach: { type: 'navigate', entryUrl: 'https://jobs.bilibili.com/campus/positions' } },
  { group: '互联网', name: '滴滴', adapter: 'moka', moka: { org: 'didiglobal', siteId: '96064', base: 'https://campus.didiglobal.com', pathPrefix: 'campus_apply', section: 'campus' }, url: 'https://campus.didiglobal.com' },
  { group: '互联网', name: '蚂蚁集团', adapter: 'ant', url: 'https://talent.antgroup.com' },
  { group: '互联网', name: '小米', adapter: 'byte', byte: { base: 'https://xiaomi.jobs.f.mioffice.cn', campusPath: '/campus/' }, url: 'https://xiaomi.jobs.f.mioffice.cn', reach: { type: 'direct', urlTemplate: 'https://xiaomi.jobs.f.mioffice.cn/campus/position/{id}/detail' } },
  { group: '互联网', name: '华为', adapter: null, url: 'https://career.huawei.com' },
  { group: '互联网', name: 'OPPO', adapter: null, url: 'https://career.oppo.com' },
  { group: '互联网', name: 'vivo', adapter: null, url: 'https://hr.vivo.com' },
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
  { group: '半导体/存储', name: '中国电科36所', adapter: 'zhiye', subdomain: 'cetc36' },
  { group: '化工/材料', name: '金发科技', adapter: 'zhiye', subdomain: 'kingfa' },
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
