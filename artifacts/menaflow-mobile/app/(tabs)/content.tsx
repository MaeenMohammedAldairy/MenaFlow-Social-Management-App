import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { BrandHeader, EmptyState, Page, PageTitle, Panel, SectionTitle, StatusPill } from '@/components/Ui';
import { useStudio, type PostStatus } from '@/context/StudioContext';
import { useColors } from '@/hooks/useColors';

function statusInfo(status: PostStatus) {
  if (status === 'review') return { label: 'بانتظار المراجعة', tone: 'amber' as const };
  if (status === 'scheduled') return { label: 'مجدول', tone: 'blue' as const };
  if (status === 'published') return { label: 'منشور', tone: 'green' as const };
  return { label: 'مسودة', tone: 'muted' as const };
}

export default function ContentScreen() {
  const colors = useColors();
  const { posts, updatePostStatus, deletePost } = useStudio();
  const [filter, setFilter] = useState<PostStatus | 'all'>('all');

  const visiblePosts = filter === 'all' ? posts : posts.filter((post) => post.status === filter);

  return (
    <Page>
      <BrandHeader />
      <PageTitle title="المحتوى" subtitle="أنشئ المسودات وراجعها قبل النشر." action={<Pressable accessibilityRole="button" onPress={() => router.push('/compose')} style={[styles.addButton, { backgroundColor: colors.primary }]}><Feather name="plus" size={19} color={colors.primaryForeground} /></Pressable>} />

      <Panel>
        <SectionTitle title="مساحة النشر" />
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>المسودات والمراجعات محفوظة محلياً، ولا تُرسل إلى أي منصة قبل تفعيل الربط.</Text>
        <View style={styles.filterRow}>
          {[
            { key: 'all' as const, label: 'الكل' },
            { key: 'draft' as const, label: 'مسودات' },
            { key: 'review' as const, label: 'مراجعة' },
            { key: 'scheduled' as const, label: 'مجدول' },
          ].map((item) => (
            <Pressable key={item.key} onPress={() => setFilter(item.key)} style={[styles.filterChip, { backgroundColor: filter === item.key ? colors.primary : colors.secondary }]}>
              <Text style={[styles.filterLabel, { color: filter === item.key ? colors.primaryForeground : colors.mutedForeground }]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
        {visiblePosts.length === 0 ? (
          <EmptyState icon="file-plus" title={filter === 'all' ? 'لا توجد منشورات بعد' : 'لا توجد عناصر في هذا القسم'} body={filter === 'all' ? 'أنشئ منشوراً جديداً لتحويل فكرتك إلى مسودة.' : 'ستظهر هنا العناصر التي تطابق هذا التصنيف.'} />
        ) : visiblePosts.map((post) => {
          const status = statusInfo(post.status);
          return (
            <View key={post.id} style={[styles.postCard, { borderColor: colors.border }]}>
              <View style={styles.postHeader}>
                <StatusPill label={status.label} tone={status.tone} />
                <View style={styles.postTitleWrap}>
                  <Text style={[styles.postTitle, { color: colors.foreground }]} numberOfLines={1}>{post.title || 'منشور بدون عنوان'}</Text>
                  <Text style={[styles.postDate, { color: colors.mutedForeground }]}>{new Date(post.createdAt).toLocaleDateString('ar')}</Text>
                </View>
              </View>
              <Text style={[styles.postBody, { color: colors.mutedForeground }]} numberOfLines={4}>{post.body}</Text>
              <View style={styles.postFooter}>
                <View style={styles.postChannels}>
                  {post.channels.map((channel) => <Text key={channel} style={[styles.postChannel, { color: colors.primary }]}>{channel === 'instagram' ? 'إنستغرام' : channel === 'facebook' ? 'فيسبوك' : 'واتساب'}</Text>)}
                </View>
                <View style={styles.postActions}>
                  {post.status === 'draft' ? <Pressable accessibilityRole="button" onPress={() => updatePostStatus(post.id, 'review')}><Text style={[styles.reviewAction, { color: colors.primary }]}>طلب مراجعة</Text></Pressable> : null}
                  <Pressable accessibilityRole="button" accessibilityLabel="حذف المنشور" onPress={() => Alert.alert('حذف المنشور؟', 'سيُحذف هذا المنشور نهائياً من هذا الجهاز.', [{ text: 'إلغاء', style: 'cancel' }, { text: 'حذف', style: 'destructive', onPress: () => deletePost(post.id) }])}>
                    <Feather name="trash-2" size={16} color={colors.destructive} />
                  </Pressable>
                </View>
              </View>
            </View>
          );
        })}
      </Panel>
    </Page>
  );
}

const styles = StyleSheet.create({
  addButton: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  intro: { textAlign: 'right', lineHeight: 19, fontSize: 12 },
  filterRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
  filterLabel: { fontSize: 11, fontWeight: '700' },
  postCard: { borderWidth: 1, borderRadius: 16, padding: 12, gap: 10 },
  postHeader: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  postTitleWrap: { flex: 1, alignItems: 'flex-end', gap: 3 },
  postTitle: { fontSize: 14, fontWeight: '800' },
  postDate: { fontSize: 10 },
  postBody: { textAlign: 'right', fontSize: 12, lineHeight: 19 },
  postFooter: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  postChannels: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6 },
  postChannel: { fontSize: 10, fontWeight: '700' },
  postActions: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12 },
  reviewAction: { fontSize: 11, fontWeight: '800' },
});
