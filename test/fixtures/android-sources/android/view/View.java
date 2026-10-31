package android.view;

/**
 * 极简 View 夹具：只保留成员解析与继承需要的形状。
 */
public class View implements ViewParent {
    public static final int NO_ID = -1;

    private int mId = NO_ID;

    public View() {
    }

    /**
     * Returns this view's identifier.
     */
    public int getId() {
        return mId;
    }

    public void setId(int id) {
        mId = id;
    }

    public View getRootView() {
        return this;
    }
}
