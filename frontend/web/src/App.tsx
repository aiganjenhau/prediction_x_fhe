import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface PredictionEvent {
  id: string;
  title: string;
  description: string;
  category: string;
  encryptedStake: string;
  publicOdds: number;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue?: number;
  outcome?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<PredictionEvent[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newEventData, setNewEventData] = useState({ 
    title: "", 
    description: "", 
    category: "新闻", 
    stake: "",
    odds: 2 
  });
  const [selectedEvent, setSelectedEvent] = useState<PredictionEvent | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("全部");
  const [stats, setStats] = useState({ total: 0, verified: 0, active: 0 });

  const { initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevm = async () => {
      if (isConnected && !isInitialized) {
        try {
          await initialize();
        } catch (error) {
          console.error('FHEVM init failed:', error);
        }
      }
    };
    initFhevm();
  }, [isConnected, isInitialized, initialize]);

  useEffect(() => {
    const loadData = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        const contract = await getContractReadOnly();
        if (!contract) return;
        
        const businessIds = await contract.getAllBusinessIds();
        const eventsList: PredictionEvent[] = [];
        
        for (const businessId of businessIds) {
          try {
            const businessData = await contract.getBusinessData(businessId);
            eventsList.push({
              id: businessId,
              title: businessData.name,
              description: businessData.description,
              category: "新闻",
              encryptedStake: businessId,
              publicOdds: Number(businessData.publicValue1) || 2,
              creator: businessData.creator,
              timestamp: Number(businessData.timestamp),
              isVerified: businessData.isVerified,
              decryptedValue: Number(businessData.decryptedValue) || 0
            });
          } catch (e) {
            console.error('Error loading event:', e);
          }
        }
        
        setEvents(eventsList);
        updateStats(eventsList);
      } catch (e) {
        console.error('Failed to load data:', e);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [isConnected]);

  const updateStats = (eventsList: PredictionEvent[]) => {
    setStats({
      total: eventsList.length,
      verified: eventsList.filter(e => e.isVerified).length,
      active: eventsList.filter(e => !e.isVerified).length
    });
  };

  const createEvent = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingEvent(true);
    setTransactionStatus({ visible: true, status: "pending", message: "创建加密预测事件..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("合约连接失败");
      
      const stakeValue = parseInt(newEventData.stake) || 0;
      const businessId = `prediction-${Date.now()}`;
      
      const encryptedResult = await encrypt(await contract.getAddress(), address, stakeValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newEventData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        newEventData.odds,
        0,
        newEventData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "等待交易确认..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "预测事件创建成功!" });
      
      const updatedEvents = [...events, {
        id: businessId,
        title: newEventData.title,
        description: newEventData.description,
        category: newEventData.category,
        encryptedStake: businessId,
        publicOdds: newEventData.odds,
        creator: address,
        timestamp: Date.now() / 1000,
        isVerified: false
      }];
      
      setEvents(updatedEvents);
      updateStats(updatedEvents);
      setShowCreateModal(false);
      setNewEventData({ title: "", description: "", category: "新闻", stake: "", odds: 2 });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected") 
        ? "用户取消交易" 
        : "创建失败: " + (e.message || "未知错误");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
    } finally { 
      setCreatingEvent(false); 
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const decryptStake = async (eventId: string) => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(eventId);
      if (businessData.isVerified) {
        return Number(businessData.decryptedValue) || 0;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(eventId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        await contractRead.getAddress(),
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(eventId, abiEncodedClearValues, decryptionProof)
      );
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      const updatedEvents = events.map(event => 
        event.id === eventId ? { ...event, isVerified: true, decryptedValue: Number(clearValue) } : event
      );
      
      setEvents(updatedEvents);
      updateStats(updatedEvents);
      
      setTransactionStatus({ visible: true, status: "success", message: "下注金额解密成功!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      setTransactionStatus({ visible: true, status: "error", message: "解密失败" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (contract) {
        const available = await contract.isAvailable();
        setTransactionStatus({ visible: true, status: "success", message: "合约可用性检查成功!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      console.error('Availability check failed:', e);
    }
  };

  const filteredEvents = events.filter(event => {
    const matchesSearch = event.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         event.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = filterCategory === "全部" || event.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  const categories = ["全部", "新闻", "政治", "体育", "娱乐", "金融"];

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🔮 Private Prediction Market</h1>
            <span>FHE加密预测市场</span>
          </div>
          <ConnectButton />
        </header>
        
        <div className="connection-prompt">
          <div className="prompt-content">
            <div className="fhe-icon">🔐</div>
            <h2>连接钱包进入加密预测市场</h2>
            <p>使用FHE全同态加密技术保护您的预测隐私</p>
            <div className="feature-grid">
              <div className="feature-card">
                <div className="feature-icon">💰</div>
                <h3>加密下注</h3>
                <p>下注金额和方向完全加密</p>
              </div>
              <div className="feature-card">
                <div className="feature-icon">📊</div>
                <h3>同态计算</h3>
                <p>赔率计算不泄露原始数据</p>
              </div>
              <div className="feature-card">
                <div className="feature-icon">⚡</div>
                <h3>私密结算</h3>
                <p>自动完成加密结算流程</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="neon-spinner"></div>
      <p>加载加密预测市场...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-left">
          <div className="logo">
            <h1>🔮 Private Prediction Market</h1>
            <span>FHE加密预测市场</span>
          </div>
          <nav className="main-nav">
            <button className="nav-btn active">市场</button>
            <button className="nav-btn">我的预测</button>
            <button className="nav-btn">排行榜</button>
          </nav>
        </div>
        
        <div className="header-right">
          <button onClick={checkAvailability} className="status-btn">
            检查合约状态
          </button>
          <ConnectButton />
        </div>
      </header>

      <div className="main-content">
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">总预测事件</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.active}</div>
            <div className="stat-label">进行中</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.verified}</div>
            <div className="stat-label">已结算</div>
          </div>
        </div>

        <div className="controls-bar">
          <div className="search-box">
            <input 
              type="text" 
              placeholder="搜索预测事件..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
          </div>
          
          <div className="filter-group">
            <select 
              value={filterCategory} 
              onChange={(e) => setFilterCategory(e.target.value)}
              className="category-select"
            >
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
          
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-event-btn"
          >
            + 创建预测事件
          </button>
        </div>

        <div className="events-grid">
          {filteredEvents.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🔮</div>
              <h3>暂无预测事件</h3>
              <p>创建第一个加密预测事件开始交易</p>
              <button 
                className="create-btn"
                onClick={() => setShowCreateModal(true)}
              >
                创建预测事件
              </button>
            </div>
          ) : (
            filteredEvents.map((event, index) => (
              <div 
                key={event.id} 
                className="event-card"
                onClick={() => setSelectedEvent(event)}
              >
                <div className="card-header">
                  <span className="category-tag">{event.category}</span>
                  <span className={`status-badge ${event.isVerified ? 'verified' : 'active'}`}>
                    {event.isVerified ? '已结算' : '进行中'}
                  </span>
                </div>
                
                <h3 className="event-title">{event.title}</h3>
                <p className="event-desc">{event.description}</p>
                
                <div className="event-meta">
                  <div className="meta-item">
                    <span>赔率</span>
                    <strong>{event.publicOdds}x</strong>
                  </div>
                  <div className="meta-item">
                    <span>下注</span>
                    <strong>
                      {event.isVerified && event.decryptedValue 
                        ? `${event.decryptedValue} USDC` 
                        : '🔒 加密中'
                      }
                    </strong>
                  </div>
                </div>
                
                <div className="card-footer">
                  <span className="creator">
                    {event.creator.substring(0, 6)}...{event.creator.substring(38)}
                  </span>
                  <button 
                    className={`decrypt-btn ${event.isVerified ? 'verified' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      decryptStake(event.id);
                    }}
                  >
                    {event.isVerified ? '✅ 已解密' : '🔓 解密'}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>创建加密预测事件</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-btn">×</button>
            </div>
            
            <div className="modal-body">
              <div className="fhe-notice">
                <div className="notice-icon">🔐</div>
                <p>下注金额将使用FHE技术加密存储，保护您的预测隐私</p>
              </div>
              
              <div className="form-group">
                <label>事件标题</label>
                <input 
                  type="text" 
                  value={newEventData.title}
                  onChange={(e) => setNewEventData({...newEventData, title: e.target.value})}
                  placeholder="输入预测事件标题"
                />
              </div>
              
              <div className="form-group">
                <label>事件描述</label>
                <textarea 
                  value={newEventData.description}
                  onChange={(e) => setNewEventData({...newEventData, description: e.target.value})}
                  placeholder="详细描述预测事件"
                  rows={3}
                />
              </div>
              
              <div className="form-row">
                <div className="form-group">
                  <label>分类</label>
                  <select 
                    value={newEventData.category}
                    onChange={(e) => setNewEventData({...newEventData, category: e.target.value})}
                  >
                    {categories.filter(cat => cat !== "全部").map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                
                <div className="form-group">
                  <label>公开赔率</label>
                  <input 
                    type="number" 
                    min="1" 
                    max="100"
                    value={newEventData.odds}
                    onChange={(e) => setNewEventData({...newEventData, odds: Number(e.target.value)})}
                  />
                </div>
              </div>
              
              <div className="form-group">
                <label>加密下注金额 (USDC)</label>
                <input 
                  type="number" 
                  value={newEventData.stake}
                  onChange={(e) => setNewEventData({...newEventData, stake: e.target.value})}
                  placeholder="输入下注金额"
                />
                <div className="input-hint">🔐 此金额将被FHE加密</div>
              </div>
            </div>
            
            <div className="modal-footer">
              <button 
                onClick={() => setShowCreateModal(false)}
                className="cancel-btn"
              >
                取消
              </button>
              <button 
                onClick={createEvent}
                disabled={creatingEvent || isEncrypting || !newEventData.title || !newEventData.stake}
                className="submit-btn"
              >
                {creatingEvent || isEncrypting ? "加密创建中..." : "创建预测事件"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedEvent && (
        <div className="modal-overlay">
          <div className="detail-modal">
            <div className="modal-header">
              <h2>预测事件详情</h2>
              <button onClick={() => setSelectedEvent(null)} className="close-btn">×</button>
            </div>
            
            <div className="modal-body">
              <div className="event-detail">
                <div className="detail-header">
                  <span className="category-badge">{selectedEvent.category}</span>
                  <h3>{selectedEvent.title}</h3>
                </div>
                
                <p className="detail-desc">{selectedEvent.description}</p>
                
                <div className="detail-stats">
                  <div className="stat-item">
                    <span>当前赔率</span>
                    <div className="odds-display">{selectedEvent.publicOdds}x</div>
                  </div>
                  <div className="stat-item">
                    <span>下注状态</span>
                    <div className={`stake-status ${selectedEvent.isVerified ? 'decrypted' : 'encrypted'}`}>
                      {selectedEvent.isVerified && selectedEvent.decryptedValue 
                        ? `已解密: ${selectedEvent.decryptedValue} USDC`
                        : '🔒 加密中'
                      }
                    </div>
                  </div>
                </div>
                
                <div className="fhe-process">
                  <h4>FHE加密流程</h4>
                  <div className="process-steps">
                    <div className="step">
                      <div className="step-number">1</div>
                      <div className="step-content">
                        <strong>数据加密</strong>
                        <p>下注金额在客户端使用FHE加密</p>
                      </div>
                    </div>
                    <div className="step">
                      <div className="step-number">2</div>
                      <div className="step-content">
                        <strong>链上存储</strong>
                        <p>加密数据安全存储在区块链上</p>
                      </div>
                    </div>
                    <div className="step">
                      <div className="step-number">3</div>
                      <div className="step-content">
                        <strong>同态计算</strong>
                        <p>赔率计算不暴露原始数据</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => setSelectedEvent(null)} className="close-btn">关闭</button>
              {!selectedEvent.isVerified && (
                <button 
                  onClick={() => decryptStake(selectedEvent.id)}
                  className="decrypt-action-btn"
                >
                  解密下注金额
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          <div className="toast-content">
            <div className="toast-icon">
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✕"}
            </div>
            <span>{transactionStatus.message}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;


